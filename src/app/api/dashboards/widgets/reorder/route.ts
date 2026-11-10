import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
export const dynamic = 'force-dynamic'

/**
 * POST /api/dashboards/widgets/reorder — bulk-update the `order` column.
 * Body: { order: string[] } where the array index is the new order.
 * Org-scoped: only widgets whose organizationId matches the caller's org
 * are touched; foreign ids in the payload are ignored.
 */
export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const body = await req.json().catch(() => null)
    const order = body?.order
    if (!Array.isArray(order) || order.some((id) => typeof id !== 'string') || order.length === 0) {
      return NextResponse.json({ error: 'Invalid order — expected a non-empty array of widget ids' }, { status: 400 })
    }

    // Scope to this org: resolve which of the submitted ids actually belong to it.
    const owned = await db.dashboardWidget.findMany({
      where: { id: { in: order }, organizationId: orgId },
      select: { id: true },
    })
    const ownedIds = new Set(owned.map((w) => w.id))
    const scoped = order.filter((id: string) => ownedIds.has(id))

    await db.$transaction(
      scoped.map((id: string, idx: number) =>
        db.dashboardWidget.updateMany({
          where: { id, organizationId: orgId },
          data: { order: idx },
        }),
      ),
    )

    if (scoped.length > 0) {
      await audit({
        organizationId: orgId,
        actorId: session.userId,
        action: 'dashboard.widget.reorder',
        targetType: 'dashboard_widget',
        metadata: { count: scoped.length, order: scoped },
      })
    }

    return NextResponse.json({ ok: true, updated: scoped.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
