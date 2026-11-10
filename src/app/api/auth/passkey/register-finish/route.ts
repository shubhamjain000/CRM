import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { verifyRegistration, webauthnContextFromRequest } from '@/lib/auth/passkey'
import { audit } from '@/lib/auth/audit'
import { getTenant } from '@/lib/auth/tenant'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.response) return NextResponse.json({ error: 'Missing response' }, { status: 400 })

  try {
    await verifyRegistration(session.userId, body.response, body.name || 'Passkey', webauthnContextFromRequest(req, body.origin))
    const tenant = await getTenant(session.userId)
    await audit({
      organizationId: tenant?.organization.id ?? null,
      actorId: session.userId,
      action: 'passkey.register',
      targetType: 'user',
      targetId: session.userId,
      ip: req.headers.get('x-forwarded-for') || null,
      userAgent: req.headers.get('user-agent') || null,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Registration failed' },
      { status: 400 },
    )
  }
}
