'use client'

import * as React from 'react'
import {
  Loader2, Plus, Trash2, Database, BarChart3, Donut, Table, PieChart,
  TrendingUp, Filter, Save, Wand2,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Static catalog (mirrors src/lib/reports/handler.ts)
// ---------------------------------------------------------------------------

export const SOURCE_MODELS = [
  { value: 'lead', label: 'Leads' }, { value: 'contact', label: 'Contacts' },
  { value: 'account', label: 'Accounts' }, { value: 'deal', label: 'Deals' },
  { value: 'task', label: 'Tasks' }, { value: 'event', label: 'Events' },
  { value: 'call', label: 'Calls' }, { value: 'activity', label: 'Activities' },
] as const

export const CHART_TYPES = [
  { value: 'none', label: 'Table only', icon: Table, hint: 'No chart — tabular data' },
  { value: 'bar', label: 'Bar', icon: BarChart3, hint: 'Compare categories' },
  { value: 'line', label: 'Line', icon: TrendingUp, hint: 'Trends over time' },
  { value: 'pie', label: 'Pie', icon: PieChart, hint: 'Share of total' },
  { value: 'donut', label: 'Donut', icon: Donut, hint: 'Share of total with a centre total' },
  { value: 'funnel', label: 'Funnel', icon: TrendingUp, hint: 'Pipeline stages' },
] as const

export const AVAILABLE_FIELDS: Record<string, { field: string; label: string; numeric?: boolean }[]> = {
  lead: [
    { field: 'firstName', label: 'First Name' }, { field: 'lastName', label: 'Last Name' },
    { field: 'company', label: 'Company' }, { field: 'leadStatus', label: 'Status' },
    { field: 'rating', label: 'Rating' }, { field: 'leadSource', label: 'Source' },
    { field: 'industry', label: 'Industry' }, { field: 'score', label: 'Score', numeric: true },
    { field: 'createdAt', label: 'Created' },
  ],
  contact: [
    { field: 'firstName', label: 'First Name' }, { field: 'lastName', label: 'Last Name' },
    { field: 'title', label: 'Title' }, { field: 'department', label: 'Department' },
    { field: 'leadSource', label: 'Source' }, { field: 'createdAt', label: 'Created' },
  ],
  account: [
    { field: 'name', label: 'Name' }, { field: 'accountType', label: 'Account Type' },
    { field: 'industry', label: 'Industry' }, { field: 'annualRevenue', label: 'Annual Revenue', numeric: true },
    { field: 'employees', label: 'Employees', numeric: true }, { field: 'rating', label: 'Rating' },
    { field: 'createdAt', label: 'Created' },
  ],
  deal: [
    { field: 'name', label: 'Deal Name' }, { field: 'amount', label: 'Amount', numeric: true },
    { field: 'stageId', label: 'Stage' }, { field: 'closeDate', label: 'Close Date' },
    { field: 'probability', label: 'Probability', numeric: true }, { field: 'type', label: 'Type' },
    { field: 'leadSource', label: 'Source' }, { field: 'ownerId', label: 'Owner' },
    { field: 'createdAt', label: 'Created' },
  ],
  task: [
    { field: 'title', label: 'Title' }, { field: 'priority', label: 'Priority' },
    { field: 'status', label: 'Status' }, { field: 'dueDate', label: 'Due Date' },
    { field: 'createdAt', label: 'Created' },
  ],
  event: [
    { field: 'title', label: 'Title' }, { field: 'start', label: 'Start' },
    { field: 'end', label: 'End' }, { field: 'status', label: 'Status' },
    { field: 'createdAt', label: 'Created' },
  ],
  call: [
    { field: 'subject', label: 'Subject' }, { field: 'callType', label: 'Call Type' },
    { field: 'outcome', label: 'Outcome' }, { field: 'duration', label: 'Duration', numeric: true },
    { field: 'startedAt', label: 'Started At' },
  ],
  activity: [
    { field: 'action', label: 'Action' }, { field: 'module', label: 'Module' },
    { field: 'createdAt', label: 'Created' },
  ],
}

const AGGREGATE_FUNCTIONS = [
  { value: 'count', label: 'Count', needsField: false },
  { value: 'sum', label: 'Sum', needsField: true },
  { value: 'avg', label: 'Average', needsField: true },
  { value: 'min', label: 'Minimum', needsField: true },
  { value: 'max', label: 'Maximum', needsField: true },
] as const

const FILTER_OPS = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'startswith', label: 'starts with' },
  { value: 'endswith', label: 'ends with' },
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
  { value: 'gte', label: '≥' },
  { value: 'lte', label: '≤' },
  { value: 'isnull', label: 'is empty' },
  { value: 'isnotnull', label: 'is not empty' },
] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportFormValue {
  name: string
  description: string
  sourceModel: string
  chartType: string
  fields: { field: string }[]
  groupBy: string[]
  aggregates: { function: string; field: string; alias: string }[]
  filters: { AND: { field: string; op: string; value: string | number | null }[] }
  limit: number
}

interface AggRow { fn: string; field: string }
interface FilterRow { id: string; field: string; op: string; value: string }

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** When set, the dialog patches an existing report; otherwise it creates. */
  initial?: {
    id: string
    name: string
    description?: string | null
    sourceModel: string
    chartType: string
    fields: string
    filters: string
    groupBy: string
    aggregates: string
    limit: number
  } | null
  onSaved?: (id: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReportFormDialog({ open, onOpenChange, initial, onSaved }: Props) {
  const isEdit = !!initial
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [sourceModel, setSourceModel] = React.useState<string>('deal')
  const [chartType, setChartType] = React.useState<string>('bar')
  const [selectedFields, setSelectedFields] = React.useState<string[]>([])
  const [groupBy, setGroupBy] = React.useState<string[]>([])
  const [aggRows, setAggRows] = React.useState<AggRow[]>([])
  const [filterRows, setFilterRows] = React.useState<FilterRow[]>([])
  const [limit, setLimit] = React.useState(100)
  const [saving, setSaving] = React.useState(false)
  const [tab, setTab] = React.useState('source')

  // Reset/hydrate whenever the dialog opens.
  React.useEffect(() => {
    if (!open) return
    if (initial) {
      const f = safeParseArr(initial.fields)
      const fl = safeParseObj(initial.filters)
      const gb = safeParseArr(initial.groupBy)
      const ag = safeParseArr(initial.aggregates)
      setName(initial.name)
      setDescription(initial.description ?? '')
      setSourceModel(initial.sourceModel || 'deal')
      setChartType(initial.chartType || 'bar')
      setSelectedFields(f.map((x: any) => typeof x === 'string' ? x : x.field))
      setGroupBy(gb.map((x: any) => typeof x === 'string' ? x : x.field))
      setAggRows(ag.map((a: any) => ({ fn: a.function, field: a.field })))
      const andArr = Array.isArray(fl.AND) ? fl.AND : []
      setFilterRows(andArr.map((r: any, i: number) => ({
        id: `f${i}-${Math.random().toString(36).slice(2, 7)}`,
        field: r.field || '', op: r.op || 'eq', value: typeof r.value === 'string' ? r.value : JSON.stringify(r.value ?? ''),
      })))
      setLimit(initial.limit ?? 100)
    } else {
      setName('')
      setDescription('')
      setSourceModel('deal')
      setChartType('bar')
      setSelectedFields([])
      setGroupBy([])
      setAggRows([])
      setFilterRows([])
      setLimit(100)
    }
    setTab('source')
  }, [open, initial])

  // When the source model changes, prune any selected fields/groupBy/aggregates
  // that no longer exist on the new model — otherwise the report would break.
  const fieldsForModel = AVAILABLE_FIELDS[sourceModel] ?? []
  const fieldNamesForModel = React.useMemo(() => new Set(fieldsForModel.map((f) => f.field)), [fieldsForModel])
  React.useEffect(() => {
    if (!open) return
    setSelectedFields((cur) => cur.filter((f) => fieldNamesForModel.has(f)))
    setGroupBy((cur) => cur.filter((f) => fieldNamesForModel.has(f)))
    setAggRows((cur) => cur.filter((a) => !a.field || fieldNamesForModel.has(a.field) || a.fn === 'count'))
  }, [sourceModel, fieldNamesForModel, open])

  const toggleField = (field: string) => {
    setSelectedFields((cur) => cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field])
  }
  const toggleGroupBy = (field: string) => {
    setGroupBy((cur) => cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field])
  }

  const addAgg = () => setAggRows((cur) => [...cur, { fn: 'count', field: '' }])
  const updateAgg = (i: number, patch: Partial<AggRow>) => setAggRows((cur) => cur.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const removeAgg = (i: number) => setAggRows((cur) => cur.filter((_, idx) => idx !== i))

  const addFilter = () => setFilterRows((cur) => [...cur, { id: `f${Date.now()}`, field: fieldsForModel[0]?.field ?? '', op: 'eq', value: '' }])
  const updateFilter = (id: string, patch: Partial<FilterRow>) => setFilterRows((cur) => cur.map((r) => r.id === id ? { ...r, ...patch } : r))
  const removeFilter = (id: string) => setFilterRows((cur) => cur.filter((r) => r.id !== id))

  const canSave = name.trim().length > 0 && (selectedFields.length > 0 || groupBy.length > 0 || aggRows.length > 0)

  const buildPayload = (): ReportFormValue => ({
    name: name.trim(),
    description: description.trim(),
    sourceModel,
    chartType,
    fields: selectedFields.map((f) => ({ field: f })),
    groupBy,
    aggregates: aggRows
      .filter((a) => a.fn && (a.fn === 'count' || a.field))
      .map((a) => ({
        function: a.fn,
        field: a.fn === 'count' ? (a.field || 'id') : a.field,
        alias: a.fn === 'count' ? `count_${groupBy[0] ?? 'all'}` : `${a.fn}_${a.field}`,
      })),
    filters: {
      AND: filterRows
        .filter((r) => r.field && r.op)
        .map((r) => {
          const opDef = FILTER_OPS.find((o) => o.value === r.op)
          const isNullOp = r.op === 'isnull' || r.op === 'isnotnull'
          return { field: r.field, op: r.op, value: isNullOp ? null : (opDef && ['gt', 'lt', 'gte', 'lte'].includes(r.op) ? Number(r.value) || 0 : r.value) }
        }),
    },
    limit,
  })

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const payload = buildPayload()
      const res = isEdit && initial
        ? await fetch(`/api/reports/${initial.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/reports', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to save report')
      const id = isEdit && initial ? initial.id : (data as { id?: string }).id
      toast.success(isEdit ? 'Report updated' : 'Report created')
      onOpenChange(false)
      if (id) onSaved?.(id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save report')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-2xl">
        {/* Header */}
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Wand2 className="size-4 text-primary" />
            {isEdit ? 'Edit report' : 'New report'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Refine the source, columns, grouping and filters for this report.'
              : 'Configure a source, pick columns, group and aggregate, then filter the rows you want.'}
          </DialogDescription>
        </DialogHeader>

        {/* Tabbed body */}
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-6 pt-3">
            <TabsList className="bg-transparent p-0">
              <TabsTrigger value="source"><Database className="mr-1.5 size-3.5" /> Source</TabsTrigger>
              <TabsTrigger value="columns"><Table className="mr-1.5 size-3.5" /> Columns</TabsTrigger>
              <TabsTrigger value="grouping"><BarChart3 className="mr-1.5 size-3.5" /> Group & Aggregate</TabsTrigger>
              <TabsTrigger value="filters"><Filter className="mr-1.5 size-3.5" /> Filters</TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="px-6 py-5">
              {/* ── Source & Layout ───────────────────────────────────── */}
              <TabsContent value="source" className="mt-0 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="rpt-name">Report name <span className="text-destructive">*</span></Label>
                    <Input id="rpt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Deal Revenue by Stage" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Source module <span className="text-destructive">*</span></Label>
                    <Select value={sourceModel} onValueChange={setSourceModel}>
                      <SelectTrigger aria-label="Source module"><SelectValue /></SelectTrigger>
                      <SelectContent>{SOURCE_MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rpt-desc">Description</Label>
                  <Textarea id="rpt-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this report shows, who it's for…" />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>Visualization</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {CHART_TYPES.map((c) => {
                      const Icon = c.icon
                      const active = chartType === c.value
                      return (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setChartType(c.value)}
                          aria-pressed={active}
                          className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition ${active ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted/40'}`}
                        >
                          <Icon className="size-4" />
                          <span className="text-xs font-medium">{c.label}</span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">{CHART_TYPES.find((c) => c.value === chartType)?.hint}</p>
                </div>
                <Separator />
                <div className="space-y-1.5">
                  <Label htmlFor="rpt-limit">Row limit</Label>
                  <Input id="rpt-limit" type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(Math.min(Math.max(1, Number(e.target.value) || 100), 1000))} className="w-32" />
                  <p className="text-xs text-muted-foreground">Capped at 1000 rows per execution.</p>
                </div>
              </TabsContent>

              {/* ── Columns ──────────────────────────────────────────── */}
              <TabsContent value="columns" className="mt-0 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Columns to display</p>
                    <p className="text-xs text-muted-foreground">Pick the fields shown in the result table. Leave empty for all fields.</p>
                  </div>
                  <Badge variant="secondary">{selectedFields.length} selected</Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {fieldsForModel.map((f) => {
                    const checked = selectedFields.includes(f.field)
                    return (
                      <label key={f.field} className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm transition hover:bg-muted/40">
                        <Checkbox checked={checked} onCheckedChange={() => toggleField(f.field)} />
                        <span className="flex-1">{f.label}</span>
                        {f.numeric && <Badge variant="outline" className="text-[10px]">123</Badge>}
                      </label>
                    )
                  })}
                </div>
                {fieldsForModel.length === 0 && (
                  <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Pick a source module first.</p>
                )}
              </TabsContent>

              {/* ── Group & Aggregate ────────────────────────────────── */}
              <TabsContent value="grouping" className="mt-0 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Group by</p>
                      <p className="text-xs text-muted-foreground">Roll rows up by these fields. Picking one enables the chart.</p>
                    </div>
                    <Badge variant="secondary">{groupBy.length}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fieldsForModel.map((f) => {
                      const active = groupBy.includes(f.field)
                      return (
                        <button
                          key={f.field}
                          type="button"
                          onClick={() => toggleGroupBy(f.field)}
                          aria-pressed={active}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted/40'}`}
                        >
                          {f.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Aggregates</p>
                      <p className="text-xs text-muted-foreground">Compute metrics for each group (or a single total row).</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={addAgg}><Plus className="mr-1 size-3.5" /> Add metric</Button>
                  </div>
                  {aggRows.length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No metrics yet — add one to compute totals.</p>
                  ) : (
                    <div className="space-y-2">
                      {aggRows.map((row, i) => {
                        const fnDef = AGGREGATE_FUNCTIONS.find((f) => f.value === row.fn)
                        return (
                          <div key={i} className="flex items-end gap-2 rounded-md border p-2.5">
                            <div className="flex-1 space-y-1">
                              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Function</Label>
                              <Select value={row.fn} onValueChange={(v) => updateAgg(i, { fn: v })}>
                                <SelectTrigger aria-label="Aggregate function"><SelectValue /></SelectTrigger>
                                <SelectContent>{AGGREGATE_FUNCTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                            <div className="flex-1 space-y-1">
                              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Field</Label>
                              <Select value={row.field} onValueChange={(v) => updateAgg(i, { field: v })} disabled={fnDef?.needsField === false}>
                                <SelectTrigger aria-label="Aggregate field" disabled={fnDef?.needsField === false}>
                                  <SelectValue placeholder={fnDef?.needsField === false ? '—' : 'Pick field'} />
                                </SelectTrigger>
                                <SelectContent>
                                  {fieldsForModel.map((f) => <SelectItem key={f.field} value={f.field}>{f.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeAgg(i)} aria-label="Remove metric">
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ── Filters ──────────────────────────────────────────── */}
              <TabsContent value="filters" className="mt-0 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Row filters</p>
                    <p className="text-xs text-muted-foreground">All conditions must match (AND).</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={addFilter}><Plus className="mr-1 size-3.5" /> Add condition</Button>
                </div>
                {filterRows.length === 0 ? (
                  <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No filters — every row from the source will be included.</p>
                ) : (
                  <div className="space-y-2">
                    {filterRows.map((row) => {
                      const opDef = FILTER_OPS.find((o) => o.value === row.op)
                      const isNullOp = row.op === 'isnull' || row.op === 'isnotnull'
                      return (
                        <div key={row.id} className="flex items-end gap-2 rounded-md border p-2.5">
                          <div className="flex-1 space-y-1">
                            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Field</Label>
                            <Select value={row.field} onValueChange={(v) => updateFilter(row.id, { field: v })}>
                              <SelectTrigger aria-label="Filter field"><SelectValue /></SelectTrigger>
                              <SelectContent>{fieldsForModel.map((f) => <SelectItem key={f.field} value={f.field}>{f.label}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="w-36 space-y-1">
                            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Op</Label>
                            <Select value={row.op} onValueChange={(v) => updateFilter(row.id, { op: v })}>
                              <SelectTrigger aria-label="Filter operator"><SelectValue /></SelectTrigger>
                              <SelectContent>{FILTER_OPS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="flex-1 space-y-1">
                            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Value</Label>
                            <Input
                              value={isNullOp ? '' : row.value}
                              onChange={(e) => updateFilter(row.id, { value: e.target.value })}
                              disabled={isNullOp}
                              placeholder={isNullOp ? '—' : (opDef && ['gt', 'lt', 'gte', 'lte'].includes(row.op) ? 'Number' : 'Text')}
                            />
                          </div>
                          <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeFilter(row.id)} aria-label="Remove filter">
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>

        {/* Footer */}
        <DialogFooter className="border-t px-6 py-4">
          <div className="mr-auto flex flex-wrap gap-1.5">
            {selectedFields.length > 0 && <Badge variant="outline">{selectedFields.length} cols</Badge>}
            {groupBy.length > 0 && <Badge variant="outline">{groupBy.length} group{groupBy.length > 1 ? 's' : ''}</Badge>}
            {aggRows.length > 0 && <Badge variant="outline">{aggRows.length} metric{aggRows.length > 1 ? 's' : ''}</Badge>}
            {filterRows.length > 0 && <Badge variant="outline">{filterRows.length} filter{filterRows.length > 1 ? 's' : ''}</Badge>}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !canSave}>
            {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Save className="mr-1.5 size-4" />}
            {isEdit ? 'Save changes' : 'Create report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParseArr(raw: string | null | undefined): any[] {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}
function safeParseObj(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v as Record<string, unknown> : {} } catch { return {} }
}
