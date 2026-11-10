import { NextResponse } from 'next/server'
import { verifyAuthentication, webauthnContextFromRequest } from '@/lib/auth/passkey'
import { createSession, setSessionCookie, getRequestMeta } from '@/lib/auth/session'
import { recordLoginHistory } from '@/lib/auth/audit'
import { getTenant } from '@/lib/auth/tenant'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body?.email || !body?.response) {
    return NextResponse.json({ error: 'Missing email or response' }, { status: 400 })
  }
  try {
    const result = await verifyAuthentication(
      String(body.email).toLowerCase().trim(),
      body.response,
      webauthnContextFromRequest(req, body.origin),
    )
    const meta = getRequestMeta(req)
    const token = await createSession(result.userId, { ...meta, name: 'Passkey session' })
    await setSessionCookie(token)
    const tenant = await getTenant(result.userId)
    await recordLoginHistory({
      userId: result.userId,
      organizationId: tenant?.organization.id ?? null,
      ip: meta.ip,
      userAgent: meta.userAgent,
      success: true,
      method: 'passkey',
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Passkey login failed' },
      { status: 401 },
    )
  }
}
