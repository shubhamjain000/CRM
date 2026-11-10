/**
 * One-off migration: convert the existing demo dataset from USD to INR and
 * re-point phone numbers to Indian mobiles, matching the updated seed exactly:
 *  - the 6 demo products get their new INR list prices (others ×20)
 *  - price book entries follow their product (0.85 partner ratio preserved)
 *  - document line-item rates follow the product; totals recomputed
 *  - deals/campaigns/annualRevenue amounts ×20 (USD→INR realistic scale)
 *  - phones '+1-555-XXXX' → '+91 XXXXX XXXXX'
 * Idempotent: guarded by currency='USD' / '+1-555-' filters, so re-running is safe.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const r2 = (n: number) => Math.round(n * 100) / 100

const DEMO_PRICE: Record<string, number> = {
  'LIC-START': 14999,
  'LIC-ENT': 74999,
  'SVC-ONB': 45000,
  'SVC-SUP': 32000,
  'SVC-MIG': 28000,
  'ADD-MKT': 9999,
}

/** Deterministic Indian mobile from the old +1-555 tail (keeps data stable). */
function inPhone(tail: number): string {
  const a = 60000 + ((tail * 7919) % 39999)
  const b = 10000 + ((tail * 104729) % 89999)
  return `+91 ${a} ${b}`
}

interface Item { productId?: string | null; name: string; qty: number; rate: number; discountPct: number; taxPct: number }

function recompute(items: Item[]) {
  let subtotal = 0, discountTotal = 0, taxTotal = 0
  const out = items.map((it) => {
    const gross = r2(it.qty * it.rate)
    subtotal = r2(subtotal + gross)
    const discount = r2(gross * (it.discountPct / 100))
    discountTotal = r2(discountTotal + discount)
    const tax = r2((gross - discount) * (it.taxPct / 100))
    taxTotal = r2(taxTotal + tax)
    return { ...it, total: r2(gross - discount + tax) }
  })
  return { items: out, subtotal, discountTotal, taxTotal, grandTotal: r2(subtotal - discountTotal + taxTotal) }
}

async function convertPhones(kind: 'contact' | 'lead') {
  const rows = kind === 'contact'
    ? await db.contact.findMany({ where: { phones: { contains: '+1-555-' } }, select: { id: true, phones: true } })
    : await db.lead.findMany({ where: { phones: { contains: '+1-555-' } }, select: { id: true, phones: true } })
  for (const row of rows) {
    try {
      const arr = JSON.parse(row.phones) as string[]
      const next = arr.map((p) => {
        const m = /\+1-555-(\d+)/.exec(p ?? '')
        return m ? inPhone(Number(m[1])) : p
      })
      if (kind === 'contact') {
        await db.contact.update({ where: { id: row.id }, data: { phones: JSON.stringify(next) } })
      } else {
        await db.lead.update({ where: { id: row.id }, data: { phones: JSON.stringify(next) } })
      }
    } catch { /* keep malformed rows untouched */ }
  }
  return rows.length
}

async function main() {
  // Run-once guard: the campaign/revenue steps have no natural filter (no
  // currency column), so the whole script is protected by a sentinel that is
  // written only after a fully successful pass.
  const done = await db.customField.findFirst({ where: { apiName: '__inr_migrated__' } })
  if (done) {
    console.log('INR migration already applied — nothing to do')
    await db.$disconnect()
    return
  }

  // 1. Products → INR list prices
  const products = await db.product.findMany({ where: { deletedAt: null }, select: { id: true, productCode: true, unitPrice: true } })
  const newPrice: Record<string, number> = {}
  for (const p of products) {
    const target = (p.productCode && DEMO_PRICE[p.productCode]) ?? Math.round(p.unitPrice * 20)
    newPrice[p.id] = target
    if (p.unitPrice !== target) {
      await db.product.update({ where: { id: p.id }, data: { unitPrice: target } })
    }
  }
  console.log(`products updated: ${products.length} (new prices mapped)`)

  // 2. Price book entries follow the product price
  const entries = await db.priceBookEntry.findMany({ select: { id: true, productId: true, price: true } })
  for (const e of entries) {
    const target = newPrice[e.productId] !== undefined ? r2(newPrice[e.productId] * 0.85) : r2(e.price * 20)
    if (e.price !== target) await db.priceBookEntry.update({ where: { id: e.id }, data: { price: target } })
  }
  console.log(`price book entries updated: ${entries.length}`)

  // 3. Documents (quotes / sales orders / purchase orders) — rates + totals
  let docCount = 0
  for (const key of ['quote', 'salesOrder', 'purchaseOrder'] as const) {
    const model = db[key]
    const docs = await model.findMany({ where: { currency: 'USD' } })
    for (const d of docs) {
      let items: Item[] = []
      try { items = JSON.parse(d.items) as Item[] } catch { items = [] }
      const remapped = items.map((it) => ({
        ...it,
        rate: it.productId && newPrice[it.productId] !== undefined ? newPrice[it.productId] : r2(it.rate * 20),
      }))
      const t = recompute(remapped)
      await model.update({
        where: { id: d.id },
        data: {
          currency: 'INR',
          items: JSON.stringify(t.items),
          subtotal: t.subtotal, discountTotal: t.discountTotal, taxTotal: t.taxTotal, grandTotal: t.grandTotal,
        },
      })
      docCount++
    }
  }
  console.log(`documents converted: ${docCount}`)

  // 4. Deals ×20 → INR
  const deals = await db.deal.findMany({ where: { currency: 'USD' }, select: { id: true, amount: true } })
  for (const d of deals) {
    await db.deal.update({ where: { id: d.id }, data: { amount: Math.round((d.amount * 20) / 100) * 100, currency: 'INR' } })
  }
  console.log(`deals converted: ${deals.length}`)

  // 5. Campaigns ×20
  const camps = await db.campaign.findMany({ select: { id: true, budget: true, expectedRevenue: true } })
  for (const c of camps) {
    await db.campaign.update({
      where: { id: c.id },
      data: { budget: c.budget * 20, expectedRevenue: c.expectedRevenue * 20 },
    })
  }
  console.log(`campaigns converted: ${camps.length}`)

  // 6. Annual revenue ×20 (accounts + leads)
  const accounts = await db.account.findMany({ where: { deletedAt: null }, select: { id: true, annualRevenue: true } })
  for (const a of accounts) {
    if (a.annualRevenue) {
      await db.account.update({ where: { id: a.id }, data: { annualRevenue: a.annualRevenue * 20 } })
    }
  }
  const leads = await db.lead.findMany({ where: { deletedAt: null }, select: { id: true, annualRevenue: true } })
  for (const l of leads) {
    if (l.annualRevenue) {
      await db.lead.update({ where: { id: l.id }, data: { annualRevenue: l.annualRevenue * 20 } })
    }
  }
  console.log(`accounts: ${accounts.length}, leads revenue: ${leads.length} converted`)

  // 7. Phones → +91
  const cPhones = await convertPhones('contact')
  const lPhones = await convertPhones('lead')
  console.log(`phones converted — contacts: ${cPhones}, leads: ${lPhones}`)

  // 8. Mark complete so a re-run never double-scales the unguarded numbers.
  await db.customField.create({
    data: {
      organizationId: (await db.organization.findFirst({ select: { id: true } }))?.id ?? 'system',
      module: 'lead',
      label: '__inr_migrated__',
      apiName: '__inr_migrated__',
      fieldType: 'text',
      isActive: false,
    },
  })

  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
