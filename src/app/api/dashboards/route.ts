import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import {
  computeMetrics, widgetValue, ensureDefaultDashboard, getLeaderboard, WIDGET_METRIC_TYPES,
} from '@/lib/dashboard/handler'
export const dynamic = 'force-dynamic'

/**
 * GET /api/dashboards — returns the org's default dashboard with its widgets
 * joined with their live metric values. Bootstraps (and seeds) the dashboard
 * on first access.
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const dashboard = await ensureDefaultDashboard(orgId, session.userId)
    const metrics = await computeMetrics(orgId, session.userId)

    const hasLeaderboard = dashboard.widgets.some((w) => WIDGET_METRIC_TYPES.includes(w.widgetType as never))
    const leaderboardRows = hasLeaderboard ? await getLeaderboard() : []

    const widgets = dashboard.widgets.map((w) => {
      let size: string = 'md'
      try {
        const pos = JSON.parse(w.position || '{}') as { size?: string }
        if (pos?.size) size = pos.size
      } catch { /* malformed position — fall back to default */ }
      const { value, format } = widgetValue(metrics, w.widgetType)
      return {
        id: w.id,
        widgetType: w.widgetType,
        title: w.title,
        order: w.order,
        size,
        colorTheme: w.colorTheme,
        value,
        format,
        // Leaderboard rows are only attached to leaderboard widgets.
        ...(format === 'leaderboard' ? { rows: leaderboardRows.slice(0, 5) } : {}),
      }
    })

    return NextResponse.json({
      dashboard: { id: dashboard.id, name: dashboard.name, refreshInterval: dashboard.refreshInterval },
      widgets,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

/**
 * PUT /api/dashboards — update the org's default dashboard metadata
 * (name / refresh interval). Org-scoped and audit-logged.
 */
export async function PUT(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const data: { name?: string; refreshInterval?: number } = {}
    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name || name.length > 200) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
      data.name = name
    }
    if (body.refreshInterval !== undefined) {
      const ri = Number(body.refreshInterval)
      if (!Number.isInteger(ri) || ri < 10 || ri > 86400) {
        return NextResponse.json({ error: 'Invalid refreshInterval' }, { status: 400 })
      }
      data.refreshInterval = ri
    }

    const dashboard = await ensureDefaultDashboard(orgId, session.userId)
    const updated = await db.dashboard.update({
      where: { id: dashboard.id, organizationId: orgId },
      data,
    })

    await audit({
      organizationId: orgId,
      actorId: session.userId,
      action: 'dashboard.update',
      targetType: 'dashboard',
      targetId: updated.id,
      metadata: data,
    })

    return NextResponse.json({
      dashboard: { id: updated.id, name: updated.name, refreshInterval: updated.refreshInterval },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
