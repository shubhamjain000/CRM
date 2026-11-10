import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** GET /api/invoices/:id — single invoice, scoped to the caller's organization. */
export async function GET(_req: Request, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    const invoice = await db.invoice.findFirst({ where: { id, organizationId: tenant.organization.id } })
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ invoice })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/invoices/:id — hard delete. The Invoice model has no soft-delete
 * column (no deletedAt), so we verify tenant ownership then delete directly.
 * Payments referencing this invoice are set to NULL by the schema (onDelete: SetNull).
 */
export async function DELETE(req: Request, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    // Tenant scoping: verify the invoice belongs to the caller's organization.
    const invoice = await db.invoice.findFirst({ where: { id, organizationId: tenant.organization.id } })
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.invoice.delete({ where: { id: invoice.id } })
    await audit({
      organizationId: tenant.organization.id,
      actorId: session.userId,
      action: 'invoice.delete',
      targetType: 'invoice',
      targetId: invoice.id,
      metadata: { invoiceNumber: invoice.invoiceNumber },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
