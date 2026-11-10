import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
export const dynamic = 'force-dynamic'

/**
 * Price book entry management.
 * GET    ?list=1                       → entries joined with product info
 * POST   { productId, price }          → upsert one entry
 * DELETE ?productId=...                → remove one entry
 */
async function scopedBook(id: string, orgId: string) {
  return db.priceBook.findFirst({ where: { id, organizationId: orgId, deletedAt: null } })
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    if (!(await scopedBook(id, tenant.organization.id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const entries = await db.priceBookEntry.findMany({
      where: { priceBookId: id, organizationId: tenant.organization.id },
      include: { product: { select: { id: true, name: true, productCode: true, unitPrice: true, taxPercent: true, active: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ entries })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    if (!(await scopedBook(id, tenant.organization.id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const body = (await req.json().catch(() => null)) as { productId?: unknown; price?: unknown } | null
    const productId = typeof body?.productId === 'string' ? body.productId : ''
    const price = Number(body?.price)
    if (!productId || !Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: 'productId and a valid price are required' }, { status: 400 })
    }
    const product = await db.product.findFirst({
      where: { id: productId, organizationId: tenant.organization.id, deletedAt: null },
    })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const entry = await db.priceBookEntry.upsert({
      where: { priceBookId_productId: { priceBookId: id, productId } },
      update: { price },
      create: { organizationId: tenant.organization.id, priceBookId: id, productId, price },
    })
    return NextResponse.json(entry, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    if (!(await scopedBook(id, tenant.organization.id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const productId = new URL(req.url).searchParams.get('productId') ?? ''
    if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })
    await db.priceBookEntry.deleteMany({
      where: { priceBookId: id, productId, organizationId: tenant.organization.id },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
