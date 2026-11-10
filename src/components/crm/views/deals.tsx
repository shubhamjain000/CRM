'use client'

import * as React from 'react'
import { Plus, RefreshCw, IndianRupee, AlertTriangle, Users, Target, Upload } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { fmtCompactBare, fmtINRCompact, fmtINR0 } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RecordForm, type FieldDef } from '../record-form'
import { ImportWizard } from '../import-wizard'
import { createRecord, updateRecord } from '../use-crm-list'
import { useFieldSecurity } from '../use-field-security'
import { toast } from 'sonner'

interface Deal {
  id: string; name: string; amount: number; currency: string
  stageId: string; probability: number; closeDate: string | null
  accountId: string | null; ownerId: string; createdAt: string
  type?: string; nextStep?: string | null; description?: string | null
  lostReason?: string | null; forecastCategory?: string; leadSource?: string | null
}

interface AccountLite { id: string; name: string }

interface Stage {
  id: string; name: string; probability: number; order: number
  isWonStage: boolean; isLostStage: boolean
}

interface Pipeline { id: string; name: string; stages: Stage[] }

const WIP_LIMITS: Record<string, number> = {
  Prospect: 15, Qualified: 12, Proposal: 8, Negotiation: 6,
}

const COLOR_MODES = [
  { value: 'value', label: 'By Value' },
  { value: 'owner', label: 'By Owner' },
  { value: 'probability', label: 'By Probability' },
] as const

export function DealsView() {
  const [deals, setDeals] = React.useState<Deal[] | null>(null)
  const [pipeline, setPipeline] = React.useState<Pipeline | null>(null)
  const [search, setSearch] = React.useState('')
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Deal | null>(null)
  const [importOpen, setImportOpen] = React.useState(false)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [colorMode, setColorMode] = React.useState<(typeof COLOR_MODES)[number]['value']>('value')
  const [hoveredDeal, setHoveredDeal] = React.useState<Deal | null>(null)
  const [editingCustom, setEditingCustom] = React.useState<Record<string, unknown> | null>(null)
  const [accounts, setAccounts] = React.useState<AccountLite[]>([])
  // Field security (Tier 3): the kanban shows amount/probability/owner — hide
  // any of them the caller's role cannot see (fields stay protected server-side).
  const { hiddenFor } = useFieldSecurity()
  const amountHidden = hiddenFor('deal').has('amount')
  const probabilityHidden = hiddenFor('deal').has('probability')

  React.useEffect(() => {
    fetch('/api/crm/accounts?limit=200', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setAccounts(d.items ?? []))
      .catch(() => {})
  }, [])

  const load = React.useCallback(async () => {
    const [d, p] = await Promise.all([
      fetch('/api/crm/deals?limit=200', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/crm/pipelines', { cache: 'no-store' }).then((r) => r.json()),
    ])
    setDeals(d.items ?? [])
    setPipeline(p.pipelines?.[0] ?? null)
  }, [])

  React.useEffect(() => { load() }, [load])

  // Notification deep-link: 'unstop:navigate' stashes the record id here before
  // switching views. The deals board has no detail pane, so the closest match
  // is the edit form — open it once the board data has loaded.
  React.useEffect(() => {
    if (!deals) return
    try {
      const raw = sessionStorage.getItem('unstop:open-record')
      if (!raw) return
      const hit = JSON.parse(raw) as { module?: string; id?: string }
      if (hit.module !== 'deal' || !hit.id) return
      sessionStorage.removeItem('unstop:open-record')
      const deal = deals.find((d) => d.id === hit.id)
      if (deal) void openEdit(deal)
      else toast.error('That deal is not on the current pipeline board')
    } catch { /* malformed key — ignore */ }
  }, [deals])

  const stages = pipeline?.stages ?? []

  const moveDeal = async (dealId: string, newStageId: string) => {
    setDeals((prev) => prev?.map((d) => d.id === dealId ? { ...d, stageId: newStageId } : d) ?? null)
    try {
      // Route through the transition engine so StageTransition rules, role
      // permissions, amount conditions, locked stages, and stage history all
      // apply (a plain PATCH would bypass the pipeline engine entirely).
      const res = await fetch(`/api/deals/${dealId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStageId: newStageId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Move failed (${res.status})`)
      }
      toast.success('Deal moved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Move failed')
      load()
    }
  }

  const save = async (vals: Record<string, unknown>) => {
    if (!vals.stageId) {
      toast.error('No pipeline stage available — configure a pipeline first')
      return
    }
    const payload = {
      ...vals, pipelineId: pipeline?.id,
      amount: vals.amount === '' || vals.amount === null || vals.amount === undefined ? 0 : Number(vals.amount),
      probability: vals.probability === '' || vals.probability === null || vals.probability === undefined ? 0 : Number(vals.probability),
    }
    if (editing) { await updateRecord('/api/crm/deals', editing.id, payload); toast.success('Deal updated') }
    else { await createRecord('/api/crm/deals', payload); toast.success('Deal created') }
    load()
  }

  const openEdit = async (deal: Deal) => {
    setEditing(deal)
    setEditingCustom(null)
    setFormOpen(true)
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}`, { cache: 'no-store' })
      if (res.ok) {
        const full = await res.json()
        if (full?.customFields && Object.keys(full.customFields).length > 0) setEditingCustom(full.customFields)
      }
    } catch { /* form still opens without custom prefill */ }
  }

  // Big sectioned form — Zoho-style
  const FIELDS: FieldDef[] = [
    // Deal Information
    { key: 'name', label: 'Deal name', type: 'text', required: true, section: 'Deal Information' },
    { key: 'stageId', label: 'Stage', type: 'select', section: 'Deal Information',
      options: stages.map((s) => ({ value: s.id, label: s.name })) },
    { key: 'amount', label: 'Amount', type: 'currency', required: true, section: 'Deal Information', placeholder: '0.00' },
    { key: 'currency', label: 'Currency', type: 'select', section: 'Deal Information',
      options: ['INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY'].map((c) => ({ value: c, label: c })) },
    { key: 'closeDate', label: 'Close date', type: 'date', section: 'Deal Information' },
    { key: 'probability', label: 'Probability %', type: 'number', section: 'Deal Information', hint: '0–100' },
    { key: 'type', label: 'Type', type: 'select', section: 'Deal Information',
      options: [
        { value: 'new_business', label: 'New Business' },
        { value: 'existing_business', label: 'Existing Business' },
        { value: 'renewal', label: 'Renewal' },
      ] },
    { key: 'forecastCategory', label: 'Forecast category', type: 'select', section: 'Deal Information',
      options: [
        { value: 'pipeline', label: 'Pipeline' }, { value: 'best_case', label: 'Best Case' },
        { value: 'commit', label: 'Commit' }, { value: 'closed', label: 'Closed' },
        { value: 'omitted', label: 'Omitted' },
      ] },
    // Related Records
    { key: 'accountId', label: 'Account name', type: 'select', clearable: true, section: 'Related Records',
      options: accounts.map((a) => ({ value: a.id, label: a.name })) },
    { key: 'leadSource', label: 'Lead source', type: 'select', clearable: true, section: 'Related Records',
      options: ['Advertisement', 'Cold Call', 'Employee Referral', 'Partner', 'Trade Show', 'Web Download', 'Web Research', 'Chat']
        .map((s) => ({ value: s, label: s })) },
    // Additional Information
    { key: 'nextStep', label: 'Next step', type: 'text', section: 'Additional Information' },
    { key: 'lostReason', label: 'Lost reason', type: 'text', section: 'Additional Information', hint: 'Why was this deal lost?' },
    { key: 'description', label: 'Description', type: 'textarea', section: 'Additional Information' },
  ]

  const filtered = deals?.filter((d) => !search || d.name.toLowerCase().includes(search.toLowerCase())) ?? []

  const getCardColor = (deal: Deal): string => {
    if (colorMode === 'value') {
      if (deal.amount > 100000) return 'border-l-emerald-500'
      if (deal.amount > 25000) return 'border-l-amber-500'
      return 'border-l-muted-foreground/30'
    }
    if (colorMode === 'probability') {
      if (deal.probability >= 75) return 'border-l-emerald-500'
      if (deal.probability >= 50) return 'border-l-amber-500'
      return 'border-l-muted-foreground/30'
    }
    return 'border-l-primary'
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Deals</h1>
          <p className="text-sm text-muted-foreground">{pipeline?.name ?? 'No pipeline'} · {deals?.length ?? 0} deals{!amountHidden && ` · ${fmtINR0(deals?.reduce((s, d) => s + (d.amount || 0), 0) ?? 0)} total`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-9 w-40 sm:w-56" />
          {/* Color mode */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><Target className="mr-1.5 size-3.5" /> Color</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {COLOR_MODES.map((m) => (
                <DropdownMenuItem key={m.value} onClick={() => setColorMode(m.value)}>
                  {m.label}{colorMode === m.value && <span className="ml-auto">✓</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="icon" className="size-9" onClick={load} aria-label="Refresh" title="Refresh"><RefreshCw className="size-4" /></Button>
          <Button variant="outline" onClick={() => setImportOpen(true)} title="Import deals from CSV, Excel, Word, PDF or JSON">
            <Upload className="mr-1.5 size-4" /> Import
          </Button>
          <Button onClick={() => { setEditing(null); setFormOpen(true) }}><Plus className="mr-1.5 size-4" /> Add</Button>
        </div>
      </div>

      {!deals || !pipeline ? (
        <div className="grid gap-4 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}</div>
      ) : stages.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">No pipeline stages configured.</CardContent></Card>
      ) : (
        <div className="flex gap-3 ribbon pb-4">
          {stages.map((stage) => {
            const stageDeals = filtered.filter((d) => d.stageId === stage.id)
            const total = stageDeals.reduce((sum, d) => sum + (d.amount || 0), 0)
            const wipLimit = WIP_LIMITS[stage.name] ?? 99
            const isOverWip = stageDeals.length > wipLimit
            const isNearWip = stageDeals.length >= wipLimit * 0.8
            return (
              <div
                key={stage.id}
                className="w-72 shrink-0"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragId) moveDeal(dragId, stage.id); setDragId(null) }}
              >
                <div className={`mb-2 flex items-center justify-between rounded-lg border px-3 py-2 ${isOverWip ? 'border-destructive/40 bg-destructive/5' : isNearWip ? 'border-amber-500/40 bg-amber-500/5' : 'bg-muted/40'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${stage.isWonStage ? 'bg-emerald-500' : stage.isLostStage ? 'bg-destructive' : 'bg-primary'}`} />
                    <span className="text-sm font-medium">{stage.name}</span>
                    {isOverWip && <AlertTriangle className="size-3.5 text-destructive" />}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {stageDeals.length}{wipLimit < 99 && `/${wipLimit}`}{!amountHidden && ` · ${fmtINRCompact(total)}`}
                  </span>
                </div>
                <div className="space-y-2">
                  {stageDeals.map((deal) => (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={() => setDragId(deal.id)}
                      onDragEnd={() => setDragId(null)}
                      onMouseEnter={() => setHoveredDeal(deal)}
                      onMouseLeave={() => setHoveredDeal(null)}
                      onClick={() => openEdit(deal)}
                      className={`cursor-grab rounded-lg border border-l-4 bg-card p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing ${getCardColor(deal)}`}
                    >
                      <p className="font-medium text-sm">{deal.name}</p>
                      <div className="mt-2 flex items-center justify-between">
                        {!amountHidden && (
                          <span className="flex items-center gap-1 text-sm font-semibold">
                            <IndianRupee className="size-3 text-muted-foreground" />
                            {fmtCompactBare(deal.amount)}
                          </span>
                        )}
                        {!probabilityHidden && <Badge variant="outline" className="text-[10px]">{deal.probability}%</Badge>}
                      </div>
                      {deal.closeDate && (
                        <p className="mt-1.5 text-xs text-muted-foreground">Close: {new Date(deal.closeDate).toLocaleDateString()}</p>
                      )}
                      {colorMode === 'owner' && (
                        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="size-3" /> {deal.ownerId.slice(-6)}
                        </div>
                      )}
                    </div>
                  ))}
                  {stageDeals.length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Drop deals here</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Hover preview tooltip */}
      {hoveredDeal && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 rounded-lg border bg-popover p-3 shadow-lg" style={{ maxWidth: 280 }}>
          <p className="font-medium text-sm">{hoveredDeal.name}</p>
          {!amountHidden && (
            <>
              <p className="mt-1 text-xs text-muted-foreground">Amount: {fmtINR0(hoveredDeal.amount ?? 0)}</p>
              <p className="text-xs text-muted-foreground">Expected: {fmtINR0((hoveredDeal.amount ?? 0) * hoveredDeal.probability / 100)}</p>
            </>
          )}
          {!probabilityHidden && <p className="text-xs text-muted-foreground">Probability: {hoveredDeal.probability}%</p>}
          {hoveredDeal.closeDate && <p className="text-xs text-muted-foreground">Closes: {new Date(hoveredDeal.closeDate).toLocaleDateString()}</p>}
        </div>
      )}

      <RecordForm
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'Edit deal' : 'New deal'}
        description={editing ? 'Update deal information, related records and custom fields.' : 'Fill in the deal information. Fields marked * are required.'}
        fields={FIELDS}
        initial={editing ? {
          name: editing.name, amount: editing.amount, probability: editing.probability,
          currency: editing.currency ?? 'INR', closeDate: editing.closeDate?.split('T')[0],
          stageId: editing.stageId, type: editing.type ?? 'new_business',
          accountId: editing.accountId ?? '', leadSource: editing.leadSource ?? '',
          nextStep: editing.nextStep ?? '', lostReason: editing.lostReason ?? '',
          description: editing.description ?? '',
          forecastCategory: editing.forecastCategory ?? 'pipeline',
        } : {
          stageId: stages[0]?.id, amount: 0, probability: 0,
          currency: 'INR', type: 'new_business', forecastCategory: 'pipeline',
        }}
        module="deal"
        initialCustom={editingCustom}
        onSave={save}
      />
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        module="deal"
        moduleLabel="deals"
        onImported={load}
      />
    </div>
  )
}
