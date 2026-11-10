import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { getGoogleOAuthConfig, saveGoogleOAuthConfig, resolveRedirectUri, GMAIL_SCOPES, logIntegrationEvent } from '@/lib/email/google'
import { audit } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

/**
 * Google connector setup — org-level OAuth app credentials.
 *   GET  → { configured, redirectUri, scopes }
 *   POST → save { clientId, clientSecret } (Integration provider='google_oauth')
 */

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

export async function GET(req: Request) {
  try {
    const { tenant } = await ctx()
    const cfg = await getGoogleOAuthConfig(tenant.organization.id)
    return NextResponse.json({
      configured: Boolean(cfg),
      // The exact redirect URI to register in Google Cloud Console →
      // Credentials → OAuth client → Authorized redirect URIs.
      redirectUri: resolveRedirectUri(req),
      scopes: GMAIL_SCOPES,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const { session, tenant } = await ctx()
    const body = await req.json().catch(() => null)
    const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
    const clientSecret = typeof body?.clientSecret === 'string' ? body.clientSecret.trim() : ''
    if (clientId.length < 20 || clientSecret.length < 10) {
      return NextResponse.json(
        { error: 'A valid Google OAuth Client ID and Client Secret are required (Google Cloud Console → APIs & Services → Credentials)' },
        { status: 400 },
      )
    }
    await saveGoogleOAuthConfig(tenant.organization.id, { clientId, clientSecret })
    await logIntegrationEvent(tenant.organization.id, 'google_oauth', 'configured', 'info', 'Google OAuth client credentials saved')
    await audit({
      organizationId: tenant.organization.id, actorId: session.userId,
      action: 'google_oauth.configure', targetType: 'integration', targetId: 'google_oauth',
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
