'use client'

// Line-item editor shared by Quotes, Sales Orders and Purchase Orders.
// Rows pick a product (auto-filling rate + tax), set qty/discount/tax, and
// see the computed line total live. The SERVER recomputes all stored totals
// on save — this editor is display/edit only.

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtINR } from '@/lib/money'

export interface EditorItem {
  productId: string | null
  name: string
  qty: number
  rate: number
  discountPct: number
  taxPct: number
}

export interface ProductLite {
  id: string
  name: string
  unitPrice: number
  taxPercent: number
  active: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100
export const lineTotal = (it: EditorItem) =>
  r2(it.qty * it.rate * (1 - it.discountPct / 100) * (1 + it.taxPct / 100))

export function documentTotals(items: EditorItem[]) {
  let subtotal = 0
  let discount = 0
  let tax = 0
  for (const it of items) {
    const gross = r2(it.qty * it.rate)
    subtotal = r2(subtotal + gross)
    discount = r2(discount + gross * (it.discountPct / 100))
    tax = r2(tax + (gross - gross * (it.discountPct / 100)) * (it.taxPct / 100))
  }
  return { subtotal, discount, tax, grand: r2(subtotal - discount + tax) }
}

export function fmtMoney(n: number): string {
  return fmtINR(n)
}

interface Props {
  items: EditorItem[]
  onChange: (items: EditorItem[]) => void
  products: ProductLite[]
}

export function LineItemsEditor({ items, onChange, products }: Props) {
  const update = (i: number, patch: Partial<EditorItem>) => {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
    onChange(next)
  }

  const addRow = () => {
    onChange([...items, { productId: null, name: '', qty: 1, rate: 0, discountPct: 0, taxPct: 0 }])
  }

  const removeRow = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i))
  }

  const pickProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId)
    if (!p) return
    update(i, { productId: p.id, name: p.name, rate: p.unitPrice, taxPct: p.taxPercent })
  }

  const totals = documentTotals(items)

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Product</th>
              <th className="w-16 px-2 py-1.5 text-right font-medium">Qty</th>
              <th className="w-24 px-2 py-1.5 text-right font-medium">Rate</th>
              <th className="w-20 px-2 py-1.5 text-right font-medium">Disc %</th>
              <th className="w-20 px-2 py-1.5 text-right font-medium">Tax %</th>
              <th className="w-24 px-2 py-1.5 text-right font-medium">Total</th>
              <th className="w-9 px-1 py-1.5" aria-label="Remove line" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No line items yet — add one below.
                </td>
              </tr>
            )}
            {items.map((it, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-2 py-1.5">
                  <Select
                    value={it.productId ?? '__custom'}
                    onValueChange={(v) => (v === '__custom' ? update(i, { productId: null }) : pickProduct(i, v))}
                  >
                    <SelectTrigger className="h-8 text-xs" aria-label={`Line ${i + 1} product`}>
                      <SelectValue placeholder="Pick or custom" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__custom">Custom item…</SelectItem>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {it.productId === null && (
                    <Input
                      className="mt-1 h-8 text-xs"
                      placeholder="Item name"
                      value={it.name}
                      onChange={(e) => update(i, { name: e.target.value })}
                      aria-label={`Line ${i + 1} custom name`}
                    />
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    type="number" min="0" step="1" inputMode="numeric"
                    className="h-8 text-right text-xs tabular-nums"
                    value={it.qty}
                    onChange={(e) => update(i, { qty: Math.max(0, Number(e.target.value) || 0) })}
                    aria-label={`Line ${i + 1} quantity`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    className="h-8 text-right text-xs tabular-nums"
                    value={it.rate}
                    onChange={(e) => update(i, { rate: Math.max(0, Number(e.target.value) || 0) })}
                    aria-label={`Line ${i + 1} rate`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    type="number" min="0" max="100" step="1" inputMode="numeric"
                    className="h-8 text-right text-xs tabular-nums"
                    value={it.discountPct}
                    onChange={(e) => update(i, { discountPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                    aria-label={`Line ${i + 1} discount percent`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    type="number" min="0" max="100" step="1" inputMode="numeric"
                    className="h-8 text-right text-xs tabular-nums"
                    value={it.taxPct}
                    onChange={(e) => update(i, { taxPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                    aria-label={`Line ${i + 1} tax percent`}
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                  {fmtMoney(lineTotal(it))}
                </td>
                <td className="px-1 py-1.5">
                  <Button
                    type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(i)} aria-label={`Remove line ${i + 1}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="mr-1.5 size-3.5" /> Add line item
        </Button>
        <div className="ml-auto min-w-[220px] space-y-1 rounded-lg border bg-muted/30 p-2.5 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono tabular-nums">{fmtMoney(totals.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="font-mono tabular-nums">−{fmtMoney(totals.discount)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="font-mono tabular-nums">{fmtMoney(totals.tax)}</span></div>
          <div className="flex justify-between border-t pt-1 text-sm font-semibold">
            <span>Grand total</span><span className="font-mono tabular-nums">{fmtMoney(totals.grand)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
