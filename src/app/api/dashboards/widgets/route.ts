import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import {
  getDashboardWidgets, ensureDefaultDashboard, computeMetrics, widgetValue, getLeaderboard,
  WIDGET_METRIC_TYPES, WIDGET_DEFAULT_TITLES, WIDGET_COLOR_THEMES,
} from '@/lib/dashboard/handler'
export const dynamic = 'force-dynamic'

/** GET /api/dashboards/widgets — legacy flat KPI feed (kept for compatibility). */
export async function GET() {
  try { return NextResponse.json({ widgets: await getDashboardWidgets() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}

/**
 * POST /api/dashboards/widgets — create a widget on the org's default
 * dashboard. Body: { widgetType, title?, colorTheme? }. widgetType must be
 * whitelisted; order is max+1. Org-scoped and audit-logged.
 */
export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const body = await req.json().catch(() => null)
    const widgetType = body?.widgetType ? String(body.widgetType) : ''
    if (!WIDGET_METRIC_TYPES.includes(widgetType as never)) {
      return NextResponse.json({ error: 'Unknown widgetType', allowed: WIDGET_METRIC_TYPES }, { status: 400 })
    }

    let title: string | undefined
    if (body.title !== undefined && body.title !== null && String(body.title).trim() !== '') {
      title = String(body.title).trim().slice(0, 200)
    }
    if (!title) title = WIDGET_DEFAULT_TITLES[widgetType as keyof typeof WIDGET_DEFAULT_TITLES] ?? 'Widget'

    let colorTheme = 'default'
    if (body.colorTheme !== undefined && body.colorTheme !== null) {
      const ct = String(body.colorTheme)
      if (!(WIDGET_COLOR_THEMES as readonly string[]).includes(ct)) {
        return NextResponse.json({ error: 'Invalid colorTheme' }, { status: 400 })
      }
      colorTheme = ct
    }

    const dashboard = await ensureDefaultDashboard(orgId, session.userId)
    const max = await db.dashboardWidget.aggregate({
      where: { dashboardId: dashboard.id },
      _max: { order: true },
    })
    const order = (max._max.order ?? -1) + 1

    const widget = await db.dashboardWidget.create({
      data: {
        organizationId: orgId,
        dashboardId: dashboard.id,
        widgetType,
        title,
        position: JSON.stringify({ size: 'md' }),
        colorTheme,
        order,
      },
    })

    await audit({
      organizationId: orgId,
      actorId: session.userId,
      action: 'dashboard.widget.create',
      targetType: 'dashboard_widget',
      targetId: widget.id,
      metadata: { widgetType, title, order },
    })

    const metrics = await computeMetrics(orgId, session.userId)
    const { value, format } = widgetValue(metrics, widget.widgetType)
    return NextResponse.json({
      widget: {
        id: widget.id,
        widgetType: widget.widgetType,
        title: widget.title,
        order: widget.order,
        size: 'md',
        colorTheme: widget.colorTheme,
        value,
        format,
        ...(format === 'leaderboard' ? { rows: (await getLeaderboard()).slice(0, 5) } : {}),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
