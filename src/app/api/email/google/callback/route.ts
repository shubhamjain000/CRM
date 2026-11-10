import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  getGoogleOAuthConfig, exchangeGoogleCode, fetchUserEmail, resolveRedirectUri, logIntegrationEvent,
} from '@/lib/email/google'
import { encryptJson } from '@/lib/email/crypto'
import { audit } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

interface OAuthFlow {
  userId: string
  orgId: string
  verifier: string
  redirectUri: string
  iat: number
}

/**
 * GET /api/email/google/callback
 *
 * Google redirects here after the user consents. Validates the state nonce
 * (server-side, single-use, 10-min TTL), exchanges the authorization code
 * with the stored PKCE verifier, resolves the Google account email, and
 * stores the refresh token on an EmailAccount row — after which Gmail sync
 * and send work for that mailbox.
 */
export async function GET(req: Request) {
  const redirectBase = resolveRedirectUri(req).replace('/api/email/google/callback', '')
  const done = (status: 'connected' | 'error', message: string, email?: string) => {
    const p = new URLSearchParams({ gmail: status, message: message.slice(0, 300) })
    if (email) p.set('email', email)
    return NextResponse.redirect(`${redirectBase}/?${p.toString()}`)
  }

  try {
    const url = new URL(req.url)
    const errorParam = url.searchParams.get('error')
    if (errorParam) {
      const friendly =
        errorParam === 'access_denied'
          ? 'You declined the Google consent screen — no mailbox was connected'
          : `Google returned an error: ${errorParam}`
      return done('error', friendly)
    }

    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (!code || !state) return done('error', 'Google callback is missing the code/state parameters')

    // Single-use, server-side state validation (cookie-independent).
    const flowKey = `google_oauth_flow:${state}`
    const rows = await db.kVStore.findMany({ where: { key: flowKey }, take: 2 })
    const row = rows.find((r) => {
      try {
        const v = JSON.parse(r.value) as OAuthFlow
        return typeof v?.iat === 'number' && Date.now() - v.iat < 10 * 60 * 1000
      } catch {
        return false
      }
    })
    if (!row) {
      return done('error', 'This Google connection attempt expired (older than 10 minutes) or was already used — start again')
    }
    await db.kVStore.delete({ where: { id: row.id } }).catch(() => {})
    let flow: OAuthFlow
    try {
      flow = JSON.parse(row.value) as OAuthFlow
    } catch {
      return done('error', 'Corrupted connection state — start again')
    }

    const cfg = await getGoogleOAuthConfig(flow.orgId)
    if (!cfg) return done('error', 'Google OAuth credentials were removed — configure them and retry')

    const tokens = await exchangeGoogleCode({
      code,
      cfg,
      redirectUri: flow.redirectUri,
      codeVerifier: flow.verifier,
    })
    if (!tokens.refresh_token) {
      return done('error', 'Google did not return a refresh token — revoke the app at myaccount.google.com/permissions and connect again (this happens when consent was previously granted without offline access)')
    }
    const email = await fetchUserEmail(tokens.access_token)

    // Credentials are encrypted at rest (AES-256-GCM, see src/lib/email/crypto.ts).
    const creds = await encryptJson({
      mode: 'oauth',
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
    })

    const existing = await db.emailAccount.findFirst({
      where: { organizationId: flow.orgId, emailAddress: email, provider: 'gmail' },
      select: { id: true },
    })
    const account = existing
      ? await db.emailAccount.update({
          where: { id: existing.id },
          data: {
            credentials: creds,
            authMode: 'oauth',
            isActive: true,
            syncEnabled: true,
            lastSyncError: null,
            userId: flow.userId,
          },
        })
      : await db.emailAccount.create({
          data: {
            organizationId: flow.orgId,
            userId: flow.userId,
            provider: 'gmail',
            emailAddress: email,
            credentials: creds,
            authMode: 'oauth',
            syncEnabled: true,
            syncFrequency: 2,
            isActive: true,
          },
        })

    await logIntegrationEvent(flow.orgId, 'google_oauth', 'connected', 'info', `Gmail mailbox connected via OAuth: ${email}`)
    await audit({
      organizationId: flow.orgId, actorId: flow.userId,
      action: 'email_account.connect', targetType: 'email_account', targetId: account.id,
      metadata: { provider: 'gmail', authMode: 'oauth', emailAddress: email },
    })

    return done('connected', `Gmail mailbox ${email} connected — syncing inbox`, email)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return done('error', msg)
  }
}
