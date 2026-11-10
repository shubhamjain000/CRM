import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { db } from '@/lib/db'
import {
  getGoogleOAuthConfig, buildAuthorizeUrl, resolveRedirectUri,
} from '@/lib/email/google'

export const dynamic = 'force-dynamic'

/**
 * GET /api/email/google/authorize
 *
 * Starts the real Google OAuth2 authorization-code + PKCE flow:
 *  1. Verifies the org has Google OAuth credentials configured.
 *  2. Generates a 192-bit nonce and stores {userId, orgId, PKCE verifier,
 *     redirectUri} server-side in KVStore (10-minute TTL) — state travels in
 *     the `state` query param and is validated on the callback WITHOUT
 *     relying on cookies, so the flow works inside embedded previews and
 *     strict-cookie browsers.
 *  3. 302-redirects the browser to Google's consent screen.
 */
export async function GET(req: Request) {
  const redirectBase = resolveRedirectUri(req).replace('/api/email/google/callback', '')
  const fail = (reason: string) =>
    NextResponse.redirect(`${redirectBase}/?gmail=error&message=${encodeURIComponent(reason)}`)

  try {
    const session = await getSession()
    if (!session) return fail('Your session expired — sign in again and retry "Connect with Google"')
    const tenant = await getTenant(session.userId)
    if (!tenant) return fail('No organization found for your session')

    const cfg = await getGoogleOAuthConfig(tenant.organization.id)
    if (!cfg) {
      return fail('Google OAuth is not configured yet — paste the Client ID and Client Secret in the Google connector card first')
    }

    const redirectUri = resolveRedirectUri(req)
    const { url, state, verifier } = await buildAuthorizeUrl(cfg, redirectUri)

    await db.kVStore.upsert({
      where: { organizationId_key: { organizationId: tenant.organization.id, key: `google_oauth_flow:${state}` } },
      create: {
        organizationId: tenant.organization.id,
        key: `google_oauth_flow:${state}`,
        value: JSON.stringify({
          userId: session.userId,
          orgId: tenant.organization.id,
          verifier,
          redirectUri,
          iat: Date.now(),
        }),
      },
      update: { value: JSON.stringify({ userId: session.userId, orgId: tenant.organization.id, verifier, redirectUri, iat: Date.now() }) },
    })

    return NextResponse.redirect(url)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    return fail(`Could not start Google connection: ${msg}`)
  }
}
