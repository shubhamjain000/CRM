import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
export const dynamic = 'force-dynamic'

/**
 * GET /api/crm/search?q=<query>
 * Global record search for the top-bar search bar — sweeps the core CRM
 * modules plus Campaigns and Products, tenant-scoped, soft-delete aware.
 * Each module contributes at most 5 hits so no single module drowns the rest.
 */
const PER_MODULE_LIMIT = 5

export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 60)
    if (q.length < 2) return NextResponse.json({ results: [] })

    // SQLite CONTAINS is case-insensitive for ASCII out of the box.
    const contains = { contains: q }

    const [leads, contacts, accounts, deals, campaigns, products] = await Promise.all([
      db.lead.findMany({
        where: { organizationId: orgId, deletedAt: null, isConverted: false, OR: [{ firstName: contains }, { lastName: contains }, { company: contains }, { emails: contains }] },
        select: { id: true, firstName: true, lastName: true, company: true },
        take: PER_MODULE_LIMIT,
        orderBy: { createdAt: 'desc' },
      }),
      db.contact.findMany({
        where: { organizationId: orgId, deletedAt: null, OR: [{ firstName: contains }, { lastName: contains }, { emails: contains }] },
        select: { id: true, firstName: true, lastName: true, title: true },
        take: PER_MODULE_LIMIT,
        orderBy: { createdAt: 'desc' },
      }),
      db.account.findMany({
        where: { organizationId: orgId, deletedAt: null, OR: [{ name: contains }, { website: contains }] },
        select: { id: true, name: true, industry: true },
        take: PER_MODULE_LIMIT,
        orderBy: { createdAt: 'desc' },
      }),
      db.deal.findMany({
        where: { organizationId: orgId, deletedAt: null, name: contains },
        select: { id: true, name: true, amount: true },
        take: PER_MODULE_LIMIT,
        orderBy: { createdAt: 'desc' },
      }),
      db.campaign.findMany({
        where: { organizationId: orgId, deletedAt: null, name: contains },
        select: { id: true, name: true, status: true },
        take: PER_MODULE_LIMIT,
        orderBy: { createdAt: 'desc' },
      }),
      db.product.findMany({
        where: { organizationId: orgId, deletedAt: null, OR: [{ name: contains }, { productCode: contains }] },
        select: { id: true, name: true, productCode: true, unitPrice: true },
        take: PER_MODULE_LIMIT,
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const results: { module: string; id: string; name: string; subtitle: string }[] = [
      ...leads.map((r) => ({ module: 'lead', id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), subtitle: r.company || 'Lead' })),
      ...contacts.map((r) => ({ module: 'contact', id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), subtitle: r.title || 'Contact' })),
      ...accounts.map((r) => ({ module: 'account', id: r.id, name: r.name, subtitle: r.industry || 'Account' })),
      ...deals.map((r) => ({ module: 'deal', id: r.id, name: r.name, subtitle: r.amount != null ? `Deal · ${r.amount}` : 'Deal' })),
      ...campaigns.map((r) => ({ module: 'campaign', id: r.id, name: r.name, subtitle: r.status || 'Campaign' })),
      ...products.map((r) => ({ module: 'product', id: r.id, name: r.name, subtitle: r.productCode || 'Product' })),
    ]

    return NextResponse.json({ results })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
