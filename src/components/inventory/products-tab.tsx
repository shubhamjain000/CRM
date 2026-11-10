'use client'

// Products — Zoho-style product catalog (name, code, category, unit price,
// tax %, active). Feeds Price Books and every inventory document.

import * as React from 'react'
import { Package, Pencil, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { fmtMoney, type ProductLite } from './line-items-editor'

interface Product extends ProductLite {
  productCode: string | null
  category: string | null
  unit: string | null
  description: string | null
}

interface FormState {
  name: string; productCode: string; category: string; unit: string
  unitPrice: string; taxPercent: string; active: boolean; description: string
}

const EMPTY: FormState = { name: '', productCode: '', category: '', unit: '', unitPrice: '', taxPercent: '', active: true, description: '' }

export function ProductsTab({ reloadKey }: { reloadKey: number }) {
  const [items, setItems] = React.useState<Product[] | null>(null)
  const [search, setSearch] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Product | null>(null)
  const [form, setForm] = React.useState<FormState>(EMPTY)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/crm/products?limit=200&sort=name', { cache: 'no-store' })
      const data = await res.json()
      setItems(res.ok ? (data.items as Product[]) : [])
    } catch {
      setItems([])
    }
  }, [])

  React.useEffect(() => { load() }, [load, reloadKey])

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true) }

  const openEdit = (p: Product) => {
    setEditing(p)
    setForm({
      name: p.name, productCode: p.productCode ?? '', category: p.category ?? '',
      unit: p.unit ?? '', unitPrice: String(p.unitPrice ?? 0), taxPercent: String(p.taxPercent ?? 0),
      active: p.active, description: p.description ?? '',
    })
    setOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Product name is required'); return }
    const payload = {
      name: form.name.trim(),
      productCode: form.productCode.trim() || null,
      category: form.category.trim() || null,
      unit: form.unit.trim() || null,
      unitPrice: Number(form.unitPrice) || 0,
      taxPercent: Number(form.taxPercent) || 0,
      active: form.active,
      description: form.description.trim() || null,
    }
    setSaving(true)
    try {
      const res = editing
        ? await fetch(`/api/crm/products/${editing.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
          })
        : await fetch('/api/crm/products', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
          })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Save failed')
      toast.success(editing ? 'Product updated' : 'Product created')
      setOpen(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: Product) => {
    try {
      const res = await fetch(`/api/crm/products/${p.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success(`"${p.name}" moved to trash`)
      load()
    } catch {
      toast.error('Delete failed')
    }
  }

  const filtered = (items ?? []).filter((p) =>
    !search || `${p.name} ${p.productCode ?? ''} ${p.category ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" className="pl-8" aria-label="Search products" />
        </div>
        <Button onClick={openCreate}><Plus className="mr-1.5 size-4" /> New product</Button>
      </div>

      <div className="ribbon rounded-xl border">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Unit price</th>
              <th className="px-3 py-2 text-right font-medium">Tax %</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!items ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-3 py-2"><Skeleton className="h-8 w-full" /></td></tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                <Package className="mx-auto mb-2 size-8 opacity-40" aria-hidden />
                {items.length === 0 ? 'No products yet — create your first one.' : 'No products match your search.'}
              </td></tr>
            ) : filtered.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-3 py-2.5">
                  <p className="font-medium">{p.name}</p>
                  {p.productCode && <p className="font-mono text-xs text-muted-foreground">{p.productCode}</p>}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{p.category || '—'}{p.unit ? ` · ${p.unit}` : ''}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtMoney(p.unitPrice)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{p.taxPercent}%</td>
                <td className="px-3 py-2.5">
                  <Badge variant="outline" className={p.active ? 'border-emerald-500/40 text-emerald-600' : 'text-muted-foreground'}>
                    {p.active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}>
                      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) setOpen(false) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit product' : 'New product'}</DialogTitle>
            <DialogDescription>Products power price books, quotes and orders.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-name">Product name *</Label>
              <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Annual CRM License" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-code">Product code</Label>
              <Input id="p-code" value={form.productCode} onChange={(e) => setForm({ ...form, productCode: e.target.value })} placeholder="SKU-001" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-cat">Category</Label>
              <Input id="p-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Software" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-unit">Unit</Label>
              <Input id="p-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="Each / License / Hour" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-price">Unit price</Label>
              <Input id="p-price" type="number" min="0" step="0.01" inputMode="decimal" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-tax">Tax %</Label>
              <Input id="p-tax" type="number" min="0" max="100" step="1" inputMode="numeric" value={form.taxPercent} onChange={(e) => setForm({ ...form, taxPercent: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch id="p-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label htmlFor="p-active">Active (available for quoting)</Label>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-desc">Description</Label>
              <Textarea id="p-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{editing ? 'Save changes' : 'Create product'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
