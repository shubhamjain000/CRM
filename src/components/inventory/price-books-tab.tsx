'use client'

// Price Books — per-book price overrides for products (Zoho price books).
// Entries upsert immediately; the book itself saves on dialog save.

import * as React from 'react'
import { BookOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtMoney, type ProductLite } from './line-items-editor'

interface Book {
  id: string
  name: string
  description: string | null
  active: boolean
}

interface Entry {
  id: string
  productId: string
  price: number
  product?: { id: string; name: string; productCode: string | null; unitPrice: number }
}

export function PriceBooksTab({ reloadKey, products }: { reloadKey: number; products: ProductLite[] }) {
  const [books, setBooks] = React.useState<Book[] | null>(null)
  const [search, setSearch] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Book | null>(null)
  const [form, setForm] = React.useState({ name: '', description: '', active: true })
  const [saving, setSaving] = React.useState(false)

  // Entries editing state (loaded when dialog opens)
  const [entries, setEntries] = React.useState<Entry[] | null>(null)
  const [newProductId, setNewProductId] = React.useState('')
  const [newPrice, setNewPrice] = React.useState('')

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/crm/price-books?limit=200&sort=name', { cache: 'no-store' })
      const data = await res.json()
      setBooks(res.ok ? (data.items as Book[]) : [])
    } catch {
      setBooks([])
    }
  }, [])

  React.useEffect(() => { load() }, [load, reloadKey])

  const loadEntries = React.useCallback(async (bookId: string) => {
    setEntries(null)
    try {
      const res = await fetch(`/api/crm/price-books/${bookId}/entries`, { cache: 'no-store' })
      const data = await res.json()
      setEntries(res.ok ? (data.entries as Entry[]) : [])
    } catch {
      setEntries([])
    }
  }, [])

  const openCreate = () => {
    setEditing(null); setForm({ name: '', description: '', active: true }); setEntries([]); setOpen(true)
  }

  const openEdit = (b: Book) => {
    setEditing(b)
    setForm({ name: b.name, description: b.description ?? '', active: b.active })
    setOpen(true)
    loadEntries(b.id)
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Price book name is required'); return }
    const payload = { name: form.name.trim(), description: form.description.trim() || null, active: form.active }
    setSaving(true)
    try {
      const res = editing
        ? await fetch(`/api/crm/price-books/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/crm/price-books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Save failed')
      toast.success(editing ? 'Price book updated' : 'Price book created')
      setOpen(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const addEntry = async () => {
    if (!editing) return
    if (!newProductId) { toast.error('Pick a product'); return }
    const price = Number(newPrice)
    if (!Number.isFinite(price) || price < 0) { toast.error('Enter a valid price'); return }
    try {
      const res = await fetch(`/api/crm/price-books/${editing.id}/entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: newProductId, price }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed')
      setNewProductId(''); setNewPrice('')
      loadEntries(editing.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add entry')
    }
  }

  const removeEntry = async (productId: string) => {
    if (!editing) return
    try {
      await fetch(`/api/crm/price-books/${editing.id}/entries?productId=${encodeURIComponent(productId)}`, { method: 'DELETE' })
      loadEntries(editing.id)
    } catch {
      toast.error('Failed to remove entry')
    }
  }

  const remove = async (b: Book) => {
    try {
      const res = await fetch(`/api/crm/price-books/${b.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success(`"${b.name}" moved to trash`)
      load()
    } catch {
      toast.error('Delete failed')
    }
  }

  const filtered = (books ?? []).filter((b) => !search || b.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search price books…" className="pl-8" aria-label="Search price books" />
        </div>
        <Button onClick={openCreate}><Plus className="mr-1.5 size-4" /> New price book</Button>
      </div>

      <div className="ribbon rounded-xl border">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Price book</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!books ? (
              Array.from({ length: 2 }).map((_, i) => (
                <tr key={i}><td colSpan={4} className="px-3 py-2"><Skeleton className="h-8 w-full" /></td></tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                <BookOpen className="mx-auto mb-2 size-8 opacity-40" aria-hidden />
                {books.length === 0 ? 'No price books yet — override product pricing per book.' : 'No price books match your search.'}
              </td></tr>
            ) : filtered.map((b) => (
              <tr key={b.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-3 py-2.5 font-medium">{b.name}</td>
                <td className="max-w-[280px] truncate px-3 py-2.5 text-muted-foreground">{b.description || '—'}</td>
                <td className="px-3 py-2.5">
                  <Badge variant="outline" className={b.active ? 'border-emerald-500/40 text-emerald-600' : 'text-muted-foreground'}>
                    {b.active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(b)} aria-label={`Edit ${b.name}`}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => remove(b)} aria-label={`Delete ${b.name}`}>
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
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit price book' : 'New price book'}</DialogTitle>
            <DialogDescription>Set custom prices per product for special customer segments.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pb-name">Price book name *</Label>
              <Input id="pb-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Partner Pricing 2026" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pb-desc">Description</Label>
              <Textarea id="pb-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="pb-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label htmlFor="pb-active">Active</Label>
            </div>

            {/* Entries */}
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-medium">Product prices</p>
              {editing ? (
                <>
                  {!entries ? (
                    <Skeleton className="h-16 w-full" />
                  ) : (
                    <ul className="mb-3 max-h-40 space-y-1.5 overflow-y-auto" aria-label="Price book entries">
                      {entries.length === 0 && (
                        <li className="rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">
                          No entries yet — add products with custom prices below.
                        </li>
                      )}
                      {entries.map((e) => (
                        <li key={e.id} className="flex items-center gap-2 rounded-md border p-1.5 text-xs">
                          <span className="min-w-0 flex-1 truncate font-medium">{e.product?.name ?? 'Product'}</span>
                          <span className="text-muted-foreground">list {fmtMoney(e.product?.unitPrice ?? 0)}</span>
                          <span className="font-mono font-semibold tabular-nums">{fmtMoney(e.price)}</span>
                          <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-destructive" onClick={() => removeEntry(e.productId)} aria-label={`Remove ${e.product?.name}`}>
                            <Trash2 className="size-3" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <Select value={newProductId} onValueChange={setNewProductId}>
                      <SelectTrigger className="h-9 flex-1" aria-label="Product to add"><SelectValue placeholder="Pick a product…" /></SelectTrigger>
                      <SelectContent>
                        {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      className="h-9 w-28" type="number" min="0" step="0.01" inputMode="decimal"
                      placeholder="Price" value={newPrice} onChange={(e) => setNewPrice(e.target.value)}
                      aria-label="Custom price"
                    />
                    <Button type="button" size="sm" className="h-9" onClick={addEntry}>Add</Button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Save the book first, then add product prices.</p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{editing ? 'Save changes' : 'Create price book'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
