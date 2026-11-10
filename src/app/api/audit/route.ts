import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { hasPermission } from '@/lib/auth/permissions'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await getTenant(session.userId)
  if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

  if (!(await hasPermission(tenant.role.id, 'audit.read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500)

  const where: { organizationId: string; action?: string } = {
    organizationId: tenant.organization.id,
  }
  if (action) where.action = action

  const events = await db.auditLog.findMany({
    where,
    include: { actor: { select: { email: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      actorEmail: e.actor?.email ?? null,
      actorName: e.actor?.name ?? null,
      targetType: e.targetType,
      targetId: e.targetId,
      ip: e.ip,
      metadata: JSON.parse(e.metadata || '{}'),
      createdAt: e.createdAt,
    })),
  })
}
