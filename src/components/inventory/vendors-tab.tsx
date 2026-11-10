'use client'

// Vendors — suppliers/manufacturers you raise Purchase Orders against.

import * as React from 'react'
import { Pencil, Plus, Search, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Vendor {
  id: string
  name: string
  category: string | null
  website: string | null
  description: string | null
}

const CATEGORIES = ['supplier', 'manufacturer', 'distributor', 'service', 'other'] as const

export function VendorsTab({ reloadKey }: { reloadKey: number }) {
  const [items, setItems] = React.useState<Vendor[] | null>(null)
  const [search, setSearch] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Vendor | null>(null)
  const [form, setForm] = React.useState({ name: '', category: 'supplier', website: '', description: '' })
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/crm/vendors?limit=200&sort=name', { cache: 'no-store' })
      const data = await res.json()
      setItems(res.ok ? (data.items as Vendor[]) : [])
    } catch {
      setItems([])
    }
  }, [])

  React.useEffect(() => { load() }, [load, reloadKey])

  const openCreate = () => { setEditing(null); setForm({ name: '', category: 'supplier', website: '', description: '' }); setOpen(true) }

  const openEdit = (v: Vendor) => {
    setEditing(v)
    setForm({ name: v.name, category: v.category ?? 'supplier', website: v.website ?? '', description: v.description ?? '' })
    setOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Vendor name is required'); return }
    const payload = { name: form.name.trim(), category: form.category, website: form.website.trim() || null, description: form.description.trim() || null }
    setSaving(true)
    try {
      const res = editing
        ? await fetch(`/api/crm/vendors/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/crm/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Save failed')
      toast.success(editing ? 'Vendor updated' : 'Vendor created')
      setOpen(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (v: Vendor) => {
    try {
      const res = await fetch(`/api/crm/vendors/${v.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success(`"${v.name}" moved to trash`)
      load()
    } catch {
      toast.error('Delete failed')
    }
  }

  const filtered = (items ?? []).filter((v) => !search || v.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors…" className="pl-8" aria-label="Search vendors" />
        </div>
        <Button onClick={openCreate}><Plus className="mr-1.5 size-4" /> New vendor</Button>
      </div>

      <div className="ribbon rounded-xl border">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Vendor</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Website</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!items ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}><td colSpan={4} className="px-3 py-2"><Skeleton className="h-8 w-full" /></td></tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                <Truck className="mx-auto mb-2 size-8 opacity-40" aria-hidden />
                {items.length === 0 ? 'No vendors yet — add your suppliers here.' : 'No vendors match your search.'}
              </td></tr>
            ) : filtered.map((v) => (
              <tr key={v.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-3 py-2.5 font-medium">{v.name}</td>
                <td className="px-3 py-2.5">
                  <Badge variant="outline" className="capitalize">{v.category || 'other'}</Badge>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{v.website || '—'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(v)} aria-label={`Edit ${v.name}`}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => remove(v)} aria-label={`Delete ${v.name}`}>
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit vendor' : 'New vendor'}</DialogTitle>
            <DialogDescription>Vendors receive purchase orders.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-name">Vendor name *</Label>
              <Input id="v-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme Supplies" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger aria-label="Vendor category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-web">Website</Label>
              <Input id="v-web" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-desc">Description</Label>
              <Textarea id="v-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{editing ? 'Save changes' : 'Create vendor'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

