/**
 * Server-side line-item math for the inventory documents (Quote, Sales Order,
 * Purchase Order). The client sends `items` as an array of
 * `{ productId?, name, qty, rate, discountPct, taxPct }`; the server parses,
 * validates and recomputes every number so stored totals can never be
 * inflated by a tampered payload (Zoho-style CPQ integrity).
 *
 * Per line:  gross = qty × rate
 *            discount = gross × discountPct / 100
 *            net = gross − discount
 *            tax = net × taxPct / 100
 *            line total = net + tax
 * Document:  subtotal = Σ gross · grandTotal = subtotal − Σ discount + Σ tax
 */

export interface ParsedLineItem {
  productId: string | null
  name: string
  qty: number
  rate: number
  discountPct: number
  taxPct: number
  /** net + tax, rounded to 2 decimals */
  total: number
}

export interface DocumentTotals {
  items: ParsedLineItem[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  grandTotal: number
}

const MAX_ITEMS = 200
const r2 = (n: number) => Math.round(n * 100) / 100

export class DocumentItemsError extends Error {}

/**
 * Parse + validate a raw client `items` value (array or JSON string) and
 * recompute all totals. Throws DocumentItemsError with a readable message
 * when the payload is malformed so routes can answer 400.
 */
export function computeDocumentTotals(raw: unknown): DocumentTotals {
  let arr: unknown[] = []
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw) as unknown[]
    } catch {
      throw new DocumentItemsError('items is not valid JSON')
    }
  } else if (Array.isArray(raw)) {
    arr = raw
  } else {
    throw new DocumentItemsError('items must be an array')
  }
  if (arr.length > MAX_ITEMS) throw new DocumentItemsError(`Too many line items (max ${MAX_ITEMS})`)

  const items: ParsedLineItem[] = []
  let subtotal = 0
  let discountTotal = 0
  let taxTotal = 0

  for (const [i, rawItem] of arr.entries()) {
    const item = rawItem as Record<string, unknown> | null
    if (!item || typeof item !== 'object') {
      throw new DocumentItemsError(`Line ${i + 1} is not an object`)
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) throw new DocumentItemsError(`Line ${i + 1} is missing a product name`)
    const qty = Number(item.qty)
    const rate = Number(item.rate)
    if (!Number.isFinite(qty) || qty <= 0) throw new DocumentItemsError(`Line ${i + 1} has an invalid quantity`)
    if (!Number.isFinite(rate) || rate < 0) throw new DocumentItemsError(`Line ${i + 1} has an invalid rate`)
    const discountPct = clampPct(item.discountPct)
    const taxPct = clampPct(item.taxPct)

    const gross = r2(qty * rate)
    const discount = r2((gross * discountPct) / 100)
    const net = r2(gross - discount)
    const tax = r2((net * taxPct) / 100)
    const total = r2(net + tax)

    subtotal = r2(subtotal + gross)
    discountTotal = r2(discountTotal + discount)
    taxTotal = r2(taxTotal + tax)

    items.push({
      productId: typeof item.productId === 'string' && item.productId ? item.productId : null,
      name,
      qty,
      rate: r2(rate),
      discountPct,
      taxPct,
      total,
    })
  }

  const grandTotal = r2(subtotal - discountTotal + taxTotal)
  return { items, subtotal, discountTotal, taxTotal, grandTotal }
}

function clampPct(value: unknown): number {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, r2(n)))
}
