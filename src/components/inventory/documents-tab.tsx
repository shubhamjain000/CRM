'use client'

// DocumentsTab — shared CRUD for Quotes, Sales Orders and Purchase Orders.
// Each document carries Zoho-style line items; the server recomputes all
// totals on save (this UI's numbers are advisory until then).

import * as React from 'react'
import { FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  fmtMoney, LineItemsEditor, type EditorItem, type ProductLite,
} from './line-items-editor'

export type DocKind = 'quote' | 'salesOrder' | 'purchaseOrder'

interface LinkOption { id: string; label: string }

interface DocRow {
  id: string
  name: string
  status: string
  accountId: string | null
  contactId: string | null
  dealId: string | null
  vendorId: string | null
  validUntil: string | null
  items: string
  grandTotal: number
  currency: string
  terms: string | null
  description: string | null
  updatedAt: string
}

interface DocConfig {
  title: string
  singular: string
  api: string
  statuses: { value: string; label: string; className: string }[]
  validUntil: boolean
  links: 'sale' | 'vendor'
}

export const DOC_CONFIG: Record<DocKind, DocConfig> = {
  quote: {
    title: 'Quotes', singular: 'quote', api: '/api/crm/quotes', validUntil: true, links: 'sale',
    statuses: [
      { value: 'draft', label: 'Draft', className: 'text-muted-foreground' },
      { value: 'sent', label: 'Sent', className: 'border-sky-500/40 text-sky-600' },
      { value: 'accepted', label: 'Accepted', className: 'border-emerald-500/40 text-emerald-600' },
      { value: 'declined', label: 'Declined', className: 'border-destructive/40 text-destructive' },
      { value: 'expired', label: 'Expired', className: 'border-amber-500/40 text-amber-600' },
    ],
  },
  salesOrder: {
    title: 'Sales Orders', singular: 'sales order', api: '/api/crm/sales-orders', validUntil: false, links: 'sale',
    statuses: [
      { value: 'draft', label: 'Draft', className: 'text-muted-foreground' },
      { value: 'confirmed', label: 'Confirmed', className: 'border-emerald-500/40 text-emerald-600' },
      { value: 'delivered', label: 'Delivered', className: 'border-sky-500/40 text-sky-600' },
      { value: 'cancelled', label: 'Cancelled', className: 'border-destructive/40 text-destructive' },
    ],
  },
  purchaseOrder: {
    title: 'Purchase Orders', singular: 'purchase order', api: '/api/crm/purchase-orders', validUntil: false, links: 'vendor',
    statuses: [
      { value: 'draft', label: 'Draft', className: 'text-muted-foreground' },
      { value: 'issued', label: 'Issued', className: 'border-sky-500/40 text-sky-600' },
      { value: 'received', label: 'Received', className: 'border-emerald-500/40 text-emerald-600' },
      { value: 'cancelled', label: 'Cancelled', className: 'border-destructive/40 text-destructive' },
    ],
  },
}

interface Props {
  kind: DocKind
  products: ProductLite[]
  reloadKey: number
}

interface PickerData {
  accounts: LinkOption[]
  contacts: LinkOption[]
  deals: LinkOption[]
  vendors: LinkOption[]
}

const statusClass = (cfg: DocConfig, status: string) =>
  cfg.statuses.find((s) => s.value === status)?.className ?? 'text-muted-foreground'
const statusLabel = (cfg: DocConfig, status: string) =>
  cfg.statuses.find((s) => s.value === status)?.label ?? status

export function DocumentsTab({ kind, products, reloadKey }: Props) {
  const cfg = DOC_CONFIG[kind]
  const [rows, setRows] = React.useState<DocRow[] | null>(null)
  const [pickers, setPickers] = React.useState<PickerData | null>(null)
  const [search, setSearch] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<DocRow | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({
    name: '', status: 'draft', accountId: '', contactId: '', dealId: '', vendorId: '',
    validUntil: '', terms: '', description: '',
  })
  const [items, setItems] = React.useState<EditorItem[]>([])

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`${cfg.api}?limit=200&sort=-updatedAt`, { cache: 'no-store' })
      const data = await res.json()
      setRows(res.ok ? (data.items as DocRow[]) : [])
    } catch {
      setRows([])
    }
  }, [cfg.api])

  React.useEffect(() => { load() }, [load, reloadKey])

  // Link pickers: accounts/contacts/deals (sale docs) or vendors (PO)
  React.useEffect(() => {
    if (!open || pickers) return
    ;(async () => {
      const nameOf = (m: 'account' | 'contact' | 'lead' | 'vendor') =>
        m === 'contact' ? (c: Record<string, unknown>) => `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()
        : (c: Record<string, unknown>) => String(c.name ?? '')
      const grab = async (path: string, m: 'account' | 'contact' | 'vendor') => {
        const res = await fetch(`${path}?limit=200`, { cache: 'no-store' })
        if (!res.ok) return [] as LinkOption[]
        const data = await res.json()
        return ((data.items ?? []) as Record<string, unknown>[]).map((c) => ({
          id: String(c.id), label: nameOf(m)(c) || '(unnamed)',
        }))
      }
      const [accounts, contacts, vendors] = await Promise.all([
        cfg.links === 'sale' ? grab('/api/crm/accounts', 'account') : Promise.resolve([] as LinkOption[]),
        cfg.links === 'sale' ? grab('/api/crm/contacts', 'contact') : Promise.resolve([] as LinkOption[]),
        cfg.links === 'vendor' ? grab('/api/crm/vendors', 'vendor') : Promise.resolve([] as LinkOption[]),
      ])
      let deals: LinkOption[] = []
      if (cfg.links === 'sale') {
        const res = await fetch('/api/crm/deals?limit=200', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          deals = ((data.items ?? []) as Record<string, unknown>[]).map((d) => ({ id: String(d.id), label: String(d.name ?? '(deal)') }))
        }
      }
      setPickers({ accounts, contacts, deals, vendors })
    })()
  }, [open, pickers, cfg.links])

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', status: 'draft', accountId: '', contactId: '', dealId: '', vendorId: '', validUntil: '', terms: '', description: '' })
    setItems([])
    setOpen(true)
  }

  const openEdit = (row: DocRow) => {
    setEditing(row)
    let parsed: EditorItem[] = []
    try { parsed = JSON.parse(row.items || '[]') as EditorItem[] } catch { parsed = [] }
    setItems(parsed.map((it) => ({
      productId: it.productId ?? null, name: it.name ?? '', qty: Number(it.qty) || 1,
      rate: Number(it.rate) || 0, discountPct: Number(it.discountPct) || 0, taxPct: Number(it.taxPct) || 0,
    })))
    setForm({
      name: row.name, status: row.status,
      accountId: row.accountId ?? '', contactId: row.contactId ?? '', dealId: row.dealId ?? '', vendorId: row.vendorId ?? '',
      validUntil: row.validUntil ? row.validUntil.slice(0, 10) : '', terms: row.terms ?? '', description: row.description ?? '',
    })
    setOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error(`${cfg.singular} name is required`); return }
    if (items.length > 0 && items.some((it) => !it.name.trim() && !it.productId)) {
      toast.error('Every line item needs a product or name'); return
    }
    const payload: Record<string, unknown> = {
      name: form.name.trim(), status: form.status,
      items: items.map((it) => ({ ...it })),
      terms: form.terms.trim() || null, description: form.description.trim() || null,
    }
    if (cfg.links === 'sale') {
      payload.accountId = form.accountId || null
      payload.contactId = form.contactId || null
      payload.dealId = form.dealId || null
    } else {
      payload.vendorId = form.vendorId || null
    }
    if (cfg.validUntil) payload.validUntil = form.validUntil ? new Date(`${form.validUntil}T00:00:00Z`).toISOString() : null

    setSaving(true)
    try {
      const res = editing
        ? await fetch(`${cfg.api}/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(cfg.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Save failed')
      toast.success(editing ? `${cfg.singular} updated` : `${cfg.singular} created`)
      setOpen(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (row: DocRow) => {
    try {
      const res = await fetch(`${cfg.api}/${row.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success(`"${row.name}" moved to trash`)
      load()
    } catch {
      toast.error('Delete failed')
    }
  }

  const linkName = (row: DocRow) => {
    if (cfg.links === 'vendor') return pickers?.vendors.find((v) => v.id === row.vendorId)?.label ?? '—'
    return pickers?.accounts.find((a) => a.id === row.accountId)?.label ?? '—'
  }

  const filtered = (rows ?? []).filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${cfg.title.toLowerCase()}…`} className="pl-8" aria-label={`Search ${cfg.title}`} />
        </div>
        <Button onClick={openCreate}><Plus className="mr-1.5 size-4" /> New {cfg.singular}</Button>
      </div>

      <div className="ribbon rounded-xl border">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">{cfg.links === 'vendor' ? 'Vendor' : 'Account'}</th>
              <th className="px-3 py-2 text-right font-medium">Grand total</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}><td colSpan={5} className="px-3 py-2"><Skeleton className="h-8 w-full" /></td></tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                <FileText className="mx-auto mb-2 size-8 opacity-40" aria-hidden />
                {rows.length === 0 ? `No ${cfg.title.toLowerCase()} yet — create one with line items.` : 'No matches for your search.'}
              </td></tr>
            ) : filtered.map((row) => (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-3 py-2.5 font-medium">{row.name}</td>
                <td className="px-3 py-2.5">
                  <Badge variant="outline" className={statusClass(cfg, row.status)}>{statusLabel(cfg, row.status)}</Badge>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{linkName(row)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtMoney(row.grandTotal)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(row)} aria-label={`Edit ${row.name}`}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => remove(row)} aria-label={`Delete ${row.name}`}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) setOpen(false) }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${cfg.singular}` : `New ${cfg.singular}`}</DialogTitle>
            <DialogDescription>Totals are recomputed and verified on the server when you save.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="d-name">{cfg.singular} name *</Label>
                <Input id="d-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Q1 renewal — Acme" />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger aria-label={`${cfg.singular} status`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cfg.statuses.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {cfg.links === 'sale' ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Account</Label>
                    {!pickers ? <Skeleton className="h-9 w-full" /> : (
                      <Select value={form.accountId || undefined} onValueChange={(v) => setForm({ ...form, accountId: v })}>
                        <SelectTrigger aria-label="Account"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          {pickers.accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contact</Label>
                    {!pickers ? <Skeleton className="h-9 w-full" /> : (
                      <Select value={form.contactId || undefined} onValueChange={(v) => setForm({ ...form, contactId: v })}>
                        <SelectTrigger aria-label="Contact"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          {pickers.contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Deal</Label>
                    {!pickers ? <Skeleton className="h-9 w-full" /> : (
                      <Select value={form.dealId || undefined} onValueChange={(v) => setForm({ ...form, dealId: v })}>
                        <SelectTrigger aria-label="Deal"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          {pickers.deals.map((d) => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Vendor</Label>
                  {!pickers ? <Skeleton className="h-9 w-full" /> : (
                    <Select value={form.vendorId || undefined} onValueChange={(v) => setForm({ ...form, vendorId: v })}>
                      <SelectTrigger aria-label="Vendor"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        {pickers.vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              {cfg.validUntil && (
                <div className="space-y-1.5">
                  <Label htmlFor="d-valid">Valid until</Label>
                  <Input id="d-valid" type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Line items</Label>
              <LineItemsEditor items={items} onChange={setItems} products={products} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="d-terms">Terms & conditions</Label>
                <Textarea id="d-terms" rows={2} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="Payment due in 30 days…" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-desc">Description</Label>
                <Textarea id="d-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{editing ? 'Save changes' : `Create ${cfg.singular}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
