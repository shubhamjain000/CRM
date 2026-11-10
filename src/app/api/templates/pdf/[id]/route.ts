import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import {
  MAX_TEMPLATE_BODY_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
} from '@/lib/templates/defaults'
export const dynamic = 'force-dynamic'

/** PATCH /api/templates/pdf/[id] — partial update; returns the updated template. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    const data: { name?: string; htmlTemplate?: string; css?: string } = {}
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
      if (body.name.trim().length > MAX_TEMPLATE_NAME_LENGTH) return NextResponse.json({ error: `Name must be at most ${MAX_TEMPLATE_NAME_LENGTH} characters` }, { status: 400 })
      data.name = body.name.trim()
    }
    if (body.htmlTemplate !== undefined) {
      if (typeof body.htmlTemplate !== 'string') return NextResponse.json({ error: 'Invalid htmlTemplate' }, { status: 400 })
      if (body.htmlTemplate.length > MAX_TEMPLATE_BODY_LENGTH) return NextResponse.json({ error: `Body must be at most ${MAX_TEMPLATE_BODY_LENGTH} characters` }, { status: 400 })
      data.htmlTemplate = body.htmlTemplate
    }
    if (body.css !== undefined) {
      if (typeof body.css !== 'string') return NextResponse.json({ error: 'Invalid css' }, { status: 400 })
      if (body.css.length > MAX_TEMPLATE_BODY_LENGTH) return NextResponse.json({ error: `CSS must be at most ${MAX_TEMPLATE_BODY_LENGTH} characters` }, { status: 400 })
      data.css = body.css
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    // Tenant-scoped lookup first so cross-org ids 404 instead of leaking.
    const existing = await db.pdfTemplate.findFirst({
      where: { id, organizationId: tenant.organization.id },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const updated = await db.pdfTemplate.update({ where: { id }, data })
    await audit({
      organizationId: tenant.organization.id,
      actorId: session.userId,
      action: 'pdf_template.update',
      targetType: 'pdf_template',
      targetId: id,
      metadata: { name: updated.name },
    })
    return NextResponse.json({ template: updated })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

/** DELETE /api/templates/pdf/[id] */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    const existing = await db.pdfTemplate.findFirst({
      where: { id, organizationId: tenant.organization.id },
      select: { id: true, name: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.pdfTemplate.delete({ where: { id } })
    await audit({
      organizationId: tenant.organization.id,
      actorId: session.userId,
      action: 'pdf_template.delete',
      targetType: 'pdf_template',
      targetId: id,
      metadata: { name: existing.name },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
