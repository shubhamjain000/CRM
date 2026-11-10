import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { WIDGET_COLOR_THEMES } from '@/lib/dashboard/handler'
export const dynamic = 'force-dynamic'

const SIZES = ['sm', 'md', 'lg'] as const
type Size = (typeof SIZES)[number]

/**
 * PATCH /api/dashboards/widgets/[id] — update title / size / colorTheme /
 * order of a widget. Org-scoped: the widget's organizationId must match the
 * caller's org, otherwise 404.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const { id } = await params
    const existing = await db.dashboardWidget.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const data: { title?: string; colorTheme?: string; order?: number } = {}
    let nextSize: Size | undefined

    if (body.title !== undefined) {
      const title = String(body.title).trim()
      if (!title || title.length > 200) return NextResponse.json({ error: 'Invalid title' }, { status: 400 })
      data.title = title
    }
    if (body.size !== undefined) {
      const size = String(body.size)
      if (!(SIZES as readonly string[]).includes(size)) {
        return NextResponse.json({ error: 'Invalid size' }, { status: 400 })
      }
      nextSize = size as Size
    }
    if (body.colorTheme !== undefined) {
      const ct = String(body.colorTheme)
      if (!(WIDGET_COLOR_THEMES as readonly string[]).includes(ct)) {
        return NextResponse.json({ error: 'Invalid colorTheme' }, { status: 400 })
      }
      data.colorTheme = ct
    }
    if (body.order !== undefined) {
      const order = Number(body.order)
      if (!Number.isInteger(order) || order < 0) {
        return NextResponse.json({ error: 'Invalid order' }, { status: 400 })
      }
      data.order = order
    }

    // Size lives inside the position JSON ({ size: 'sm'|'md'|'lg' }).
    let position: string | undefined
    if (nextSize) {
      let pos: Record<string, unknown> = {}
      try { pos = JSON.parse(existing.position || '{}') as Record<string, unknown> } catch { /* reset */ }
      pos.size = nextSize
      position = JSON.stringify(pos)
    }

    const widget = await db.dashboardWidget.update({
      where: { id: existing.id },
      data: { ...data, ...(position !== undefined ? { position } : {}) },
    })

    await audit({
      organizationId: orgId,
      actorId: session.userId,
      action: 'dashboard.widget.update',
      targetType: 'dashboard_widget',
      targetId: widget.id,
      metadata: { ...data, ...(nextSize ? { size: nextSize } : {}) },
    })

    return NextResponse.json({ ok: true, widget: { id: widget.id, title: widget.title, colorTheme: widget.colorTheme, order: widget.order, position: widget.position } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/dashboards/widgets/[id] — remove a widget. Org-scoped
 * (404 when the widget belongs to another org) and audit-logged.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const { id } = await params
    const existing = await db.dashboardWidget.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await db.dashboardWidget.delete({ where: { id: existing.id } })

    await audit({
      organizationId: orgId,
      actorId: session.userId,
      action: 'dashboard.widget.delete',
      targetType: 'dashboard_widget',
      targetId: existing.id,
      metadata: { widgetType: existing.widgetType, title: existing.title },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
