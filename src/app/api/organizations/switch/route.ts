import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { switchTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.organizationId) {
    return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
  }

  const membership = await db.tenantMembership.findUnique({
    where: {
      userId_organizationId: {
        userId: session.userId,
        organizationId: body.organizationId,
      },
    },
  })
  if (!membership || !membership.isActive) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
  }

  await switchTenant(session.userId, body.organizationId)
  await audit({
    organizationId: body.organizationId,
    actorId: session.userId,
    action: 'org.switch',
    ip: req.headers.get('x-forwarded-for') || null,
    userAgent: req.headers.get('user-agent') || null,
  })

  return NextResponse.json({ ok: true })
}
