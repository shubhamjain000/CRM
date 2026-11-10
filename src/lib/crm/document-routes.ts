import { NextResponse } from 'next/server'
import { createTenant, updateTenant, type CrmModule } from '@/lib/crm/handler'
import { computeDocumentTotals, DocumentItemsError } from '@/lib/crm/inventory'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'

/**
 * Route factories for the inventory documents (quote / salesOrder /
 * purchaseOrder). Identical to the generic CRM routes except every write
 * passes the payload through computeDocumentTotals() first: items are
 * normalized and all money totals are recomputed server-side.
 */

const DOC_MODELS = new Set<CrmModule>(['quote', 'salesOrder', 'purchaseOrder'])

function withTotals(model: CrmModule, body: Record<string, unknown>): Record<string, unknown> {
  if (!DOC_MODELS.has(model) || body.items === undefined) return body
  const totals = computeDocumentTotals(body.items)
  return {
    ...body,
    items: JSON.stringify(totals.items),
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    grandTotal: totals.grandTotal,
  }
}

function statusFor(e: unknown): number {
  if (e instanceof Error) {
    if (e.message === 'Unauthorized') return 401
    if (e.message === 'No organization') return 403
    if (e instanceof DocumentItemsError) return 400
  }
  return 500
}

export function makeDocumentCreateRoute(model: CrmModule) {
  return async function POST(req: Request) {
    try {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
      }
      const { customFields: _omit, ...data } = body
      const record = await createTenant(model, withTotals(model, data))
      return NextResponse.json(record, { status: 201 })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: statusFor(e) })
    }
  }
}

export function makeDocumentDetailRoutes(model: CrmModule) {
  async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const tenant = await getTenant(session.userId)
      if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
      const { id } = await params
      const record = await (db[model] as any).findFirst({
        where: { id, organizationId: tenant.organization.id, deletedAt: null },
      })
      if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(record)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
    }
  }

  async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
      }
      const { customFields: _omit, ...data } = body
      await updateTenant(model, id, withTotals(model, data))
      return NextResponse.json({ ok: true })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: statusFor(e) })
    }
  }

  async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const tenant = await getTenant(session.userId)
      if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
      await (db[model] as any).updateMany({
        where: { id, organizationId: tenant.organization.id },
        data: { deletedAt: new Date() },
      })
      return NextResponse.json({ ok: true })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
    }
  }

  return { GET, PATCH, DELETE }
}
