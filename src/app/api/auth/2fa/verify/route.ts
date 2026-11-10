import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { verifyTotp, enableTwoFactor } from '@/lib/auth/totp'
import { audit } from '@/lib/auth/audit'
import { getTenant } from '@/lib/auth/tenant'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.secret || !body?.code) {
    return NextResponse.json({ error: 'Missing secret or code' }, { status: 400 })
  }

  if (!verifyTotp(String(body.secret), String(body.code))) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 401 })
  }

  await enableTwoFactor(session.userId, String(body.secret))
  const tenant = await getTenant(session.userId)
  await audit({
    organizationId: tenant?.organization.id ?? null,
    actorId: session.userId,
    action: 'user.2fa_enable',
    targetType: 'user',
    targetId: session.userId,
    ip: req.headers.get('x-forwarded-for') || null,
    userAgent: req.headers.get('user-agent') || null,
  })

  // Mark all other sessions for revocation? Keep current. Update passwordChangedAt to now.
  await db.user.update({
    where: { id: session.userId },
    data: { passwordChangedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
