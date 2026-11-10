'use client'

// Campaigns — Zoho Marketing Attribution module. Create campaigns, track
// budget vs expected revenue, and manage the audience (leads + contacts)
// with per-member statuses. Members persist as JSON on the campaign.

import * as React from 'react'
import { Megaphone, Pencil, Plus, Search, Trash2, UserPlus, X } from 'lucide-react'
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
import { fmtINR0 } from '@/lib/money'

interface Campaign {
  id: string
  name: string
  type: string
  status: string
  description: string | null
  budget: number
  expectedRevenue: number
  startDate: string | null
  endDate: string | null
  members: string
  updatedAt: string
}

interface Member {
  module: 'lead' | 'contact'
  id: string
  name: string
  status: string
}

const TYPES = ['email', 'webinar', 'conference', 'ads', 'referral', 'social', 'other'] as const
const CAMPAIGN_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const
const MEMBER_STATUSES = ['added', 'sent', 'responded', 'no_response', 'bounced'] as const
const MEMBER_STATUS_LABEL: Record<string, string> = {
  added: 'Added', sent: 'Sent', responded: 'Responded', no_response: 'No response', bounced: 'Bounced',
}

const statusBadge = (status: string) => {
  switch (status) {
    case 'active': return 'border-emerald-500/40 text-emerald-600'
    case 'completed': return 'border-sky-500/40 text-sky-600'
    case 'cancelled': return 'border-destructive/40 text-destructive'
    default: return 'text-muted-foreground'
  }
}

const fmtMoney = (n: number) => fmtINR0(n)

interface Candidate { module: 'lead' | 'contact'; id: string; name: string }

export function CampaignsView() {
  const [rows, setRows] = React.useState<Campaign[] | null>(null)
  const [search, setSearch] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Campaign | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({
    name: '', type: 'email', status: 'draft', description: '',
    budget: '', expectedRevenue: '', startDate: '', endDate: '',
  })
  const [members, setMembers] = React.useState<Member[]>([])

  // audience picker
  const [candidateQuery, setCandidateQuery] = React.useState('')
  const [candidates, setCandidates] = React.useState<Candidate[] | null>(null)
  const [searching, setSearching] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns?limit=200&sort=-updatedAt', { cache: 'no-store' })
      const data = await res.json()
      setRows(res.ok ? (data.items as Campaign[]) : [])
    } catch {
      setRows([])
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', type: 'email', status: 'draft', description: '', budget: '', expectedRevenue: '', startDate: '', endDate: '' })
    setMembers([])
    setCandidates(null)
    setCandidateQuery('')
    setOpen(true)
  }

  const openEdit = (c: Campaign) => {
    setEditing(c)
    let parsed: Member[] = []
    try { parsed = JSON.parse(c.members || '[]') as Member[] } catch { parsed = [] }
    setMembers(parsed)
    setForm({
      name: c.name, type: c.type, status: c.status, description: c.description ?? '',
      budget: String(c.budget ?? 0), expectedRevenue: String(c.expectedRevenue ?? 0),
      startDate: c.startDate ? c.startDate.slice(0, 10) : '', endDate: c.endDate ? c.endDate.slice(0, 10) : '',
    })
    setCandidates(null)
    setCandidateQuery('')
    setOpen(true)
  }

  // Debounced candidate search across leads + contacts (name contains).
  React.useEffect(() => {
    if (!open) return
    const q = candidateQuery.trim()
    if (q.length < 2) { setCandidates(null); setSearching(false); return }
    setSearching(true)
    const ctrl = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        const [leads, contacts] = await Promise.all([
          fetch(`/api/crm/leads?search=${encodeURIComponent(q)}&limit=25`, { signal: ctrl.signal, cache: 'no-store' }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
          fetch(`/api/crm/contacts?search=${encodeURIComponent(q)}&limit=25`, { signal: ctrl.signal, cache: 'no-store' }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
        ])
        const map = (list: { items?: Record<string, unknown>[] } | undefined, module: 'lead' | 'contact') =>
          (list?.items ?? []).map((c) => ({
            module, id: String(c.id),
            name: module === 'contact'
              ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()
              : `${c.firstName ?? ''} ${c.lastName ?? ''} · ${c.company ?? ''}`.trim(),
          })).filter((c) => c.name)
        setCandidates([...map(leads, 'lead'), ...map(contacts, 'contact')].slice(0, 30))
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => { ctrl.abort(); window.clearTimeout(t) }
  }, [candidateQuery, open])

  const addMember = (cand: Candidate) => {
    if (members.some((m) => m.module === cand.module && m.id === cand.id)) return
    setMembers([...members, { module: cand.module, id: cand.id, name: cand.name, status: 'added' }])
  }

  const removeMember = (m: Member) => {
    setMembers(members.filter((x) => !(x.module === m.module && x.id === m.id)))
  }

  const setMemberStatus = (m: Member, status: string) => {
    setMembers(members.map((x) => (x.module === m.module && x.id === m.id ? { ...x, status } : x)))
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Campaign name is required'); return }
    const payload: Record<string, unknown> = {
      name: form.name.trim(), type: form.type, status: form.status,
      description: form.description.trim() || null,
      budget: Number(form.budget) || 0,
      expectedRevenue: Number(form.expectedRevenue) || 0,
      startDate: form.startDate ? new Date(`${form.startDate}T00:00:00Z`).toISOString() : null,
      endDate: form.endDate ? new Date(`${form.endDate}T00:00:00Z`).toISOString() : null,
      members: JSON.stringify(members),
    }
    setSaving(true)
    try {
      const res = editing
        ? await fetch(`/api/campaigns/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Save failed')
      toast.success(editing ? 'Campaign updated' : 'Campaign created')
      setOpen(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (c: Campaign) => {
    try {
      const res = await fetch(`/api/campaigns/${c.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success(`"${c.name}" deleted`)
      load()
    } catch {
      toast.error('Delete failed')
    }
  }

  const memberCount = (c: Campaign) => {
    try { return (JSON.parse(c.members || '[]') as Member[]).length } catch { return 0 }
  }

  const responded = (c: Campaign) => {
    try {
      return (JSON.parse(c.members || '[]') as Member[]).filter((m) => m.status === 'responded').length
    } catch { return 0 }
  }

  const filtered = (rows ?? []).filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Marketing attribution — reach, budget and responses per campaign.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns…" className="pl-8" aria-label="Search campaigns" />
        </div>
        <Button onClick={openCreate}><Plus className="mr-1.5 size-4" /> New campaign</Button>
      </div>

      <div className="ribbon rounded-xl border">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Campaign</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Budget</th>
              <th className="px-3 py-2 text-right font-medium">Expected revenue</th>
              <th className="px-3 py-2 text-right font-medium">Members</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="px-3 py-2"><Skeleton className="h-8 w-full" /></td></tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                <Megaphone className="mx-auto mb-2 size-8 opacity-40" aria-hidden />
                {rows.length === 0 ? 'No campaigns yet — launch your first one.' : 'No campaigns match your search.'}
              </td></tr>
            ) : filtered.map((c) => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-3 py-2.5">
                  <p className="font-medium">{c.name}</p>
                  {c.description && <p className="max-w-[240px] truncate text-xs text-muted-foreground">{c.description}</p>}
                </td>
                <td className="px-3 py-2.5"><Badge variant="outline" className="capitalize">{c.type}</Badge></td>
                <td className="px-3 py-2.5"><Badge variant="outline" className={`capitalize ${statusBadge(c.status)}`}>{c.status}</Badge></td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtMoney(c.budget)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtMoney(c.expectedRevenue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {memberCount(c)}
                  {responded(c) > 0 && <span className="ml-1 text-xs text-emerald-600">({responded(c)} responded)</span>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(c)} aria-label={`Edit ${c.name}`}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}>
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
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit campaign' : 'New campaign'}</DialogTitle>
            <DialogDescription>Track budget, expected revenue and your audience.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="c-name">Campaign name *</Label>
                <Input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Q1 Product Launch" />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger aria-label="Campaign type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger aria-label="Campaign status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-budget">Budget</Label>
                <Input id="c-budget" type="number" min="0" step="1" inputMode="decimal" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-rev">Expected revenue</Label>
                <Input id="c-rev" type="number" min="0" step="1" inputMode="decimal" value={form.expectedRevenue} onChange={(e) => setForm({ ...form, expectedRevenue: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-start">Start date</Label>
                <Input id="c-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-end">End date</Label>
                <Input id="c-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="c-desc">Description</Label>
                <Textarea id="c-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>

            {/* Audience */}
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Audience ({members.length})</p>
                <UserPlus className="size-4 text-muted-foreground" aria-hidden />
              </div>
              {members.length > 0 && (
                <ul className="mb-3 max-h-36 space-y-1.5 overflow-y-auto" aria-label="Campaign members">
                  {members.map((m) => (
                    <li key={`${m.module}-${m.id}`} className="flex items-center gap-2 rounded-md border p-1.5">
                      <Badge variant="outline" className="shrink-0 text-[10px] uppercase">{m.module}</Badge>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{m.name}</span>
                      <Select value={m.status} onValueChange={(v) => setMemberStatus(m, v)}>
                        <SelectTrigger className="h-7 w-[130px] text-xs" aria-label={`${m.name} status`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MEMBER_STATUSES.map((s) => <SelectItem key={s} value={s}>{MEMBER_STATUS_LABEL[s]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-destructive" onClick={() => removeMember(m)} aria-label={`Remove ${m.name}`}>
                        <X className="size-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <Input
                value={candidateQuery}
                onChange={(e) => setCandidateQuery(e.target.value)}
                placeholder="Search leads & contacts to add… (type 2+ chars)"
                aria-label="Search leads and contacts"
                autoComplete="off"
              />
              {searching && <Skeleton className="mt-2 h-8 w-full" />}
              {!searching && candidates && candidates.length === 0 && candidateQuery.trim().length >= 2 && (
                <p className="mt-2 text-xs text-muted-foreground">No leads or contacts match “{candidateQuery.trim()}”.</p>
              )}
              {!searching && candidates && candidates.length > 0 && (
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto" aria-label="Matches to add">
                  {candidates.map((cand) => {
                    const added = members.some((m) => m.module === cand.module && m.id === cand.id)
                    return (
                      <li key={`${cand.module}-${cand.id}`}>
                        <button
                          type="button" disabled={added} onClick={() => addMember(cand)}
                          className={`flex w-full items-center gap-2 rounded-md border p-1.5 text-left text-xs transition-colors ${
                            added ? 'opacity-50' : 'hover:bg-muted'
                          }`}
                        >
                          <Badge variant="outline" className="text-[10px] uppercase">{cand.module}</Badge>
                          <span className="min-w-0 flex-1 truncate">{cand.name}</span>
                          {added ? <span className="text-[10px] text-emerald-600">added</span> : <Plus className="size-3" aria-hidden />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{editing ? 'Save changes' : 'Create campaign'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
