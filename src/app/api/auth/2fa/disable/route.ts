import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { disableTwoFactor } from '@/lib/auth/totp'
import { audit } from '@/lib/auth/audit'
import { getTenant } from '@/lib/auth/tenant'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await disableTwoFactor(session.userId)
  const tenant = await getTenant(session.userId)
  await audit({
    organizationId: tenant?.organization.id ?? null,
    actorId: session.userId,
    action: 'user.2fa_disable',
    targetType: 'user',
    targetId: session.userId,
    ip: req.headers.get('x-forwarded-for') || null,
    userAgent: req.headers.get('user-agent') || null,
  })

  return NextResponse.json({ ok: true })
}
