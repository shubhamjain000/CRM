'use client'

import * as React from 'react'
import { Plus, Trash2, Shield, Users, AlertTriangle, CheckCircle2, Zap, Power, Pencil } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CSM_STEPS } from '@/lib/csm'
import { toast } from 'sonner'

const MODELS = [
  { value: 'deal', label: 'Deal' }, { value: 'lead', label: 'Lead' },
  { value: 'contact', label: 'Contact' }, { value: 'account', label: 'Account' },
]

const escModelLabel = (m: string) => MODELS.find((x) => x.value === m)?.label ?? m

const INITIAL_VALIDATION_FORM = {
  targetModel: 'deal', fieldName: 'amount', conditionType: 'required', regex: '',
  min: '', max: '', errorMessage: '', errorSeverity: 'error', triggerOn: 'both',
}

export function RuleBuilderView() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rule Engine</h1>
        <p className="text-muted-foreground">Validation, assignment, and escalation rules</p>
      </div>

      <Tabs defaultValue="validation">
        <TabsList>
          <TabsTrigger value="validation"><Shield className="mr-1.5 size-3.5" /> Validation</TabsTrigger>
          <TabsTrigger value="assignment"><Users className="mr-1.5 size-3.5" /> Assignment</TabsTrigger>
          <TabsTrigger value="escalation"><AlertTriangle className="mr-1.5 size-3.5" /> Escalation</TabsTrigger>
        </TabsList>

        <TabsContent value="validation" className="mt-4"><ValidationRules /></TabsContent>
        <TabsContent value="assignment" className="mt-4"><AssignmentRules /></TabsContent>
        <TabsContent value="escalation" className="mt-4"><EscalationRules /></TabsContent>
      </Tabs>
    </div>
  )
}

function ValidationRules() {
  const [rules, setRules] = React.useState<any[] | null>(null)
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<{ fieldName?: string; regex?: string }>({})
  const [confirm, setConfirm] = React.useState<{ id: string; name: string } | null>(null)
  const [form, setForm] = React.useState(INITIAL_VALIDATION_FORM)

  const load = React.useCallback(async () => {
    const res = await fetch('/api/validation-rules', { cache: 'no-store' })
    const data = await res.json()
    setRules(data.rules ?? [])
  }, [])
  React.useEffect(() => { load() }, [load])

  const create = async () => {
    const nextErrors: { fieldName?: string; regex?: string } = {}
    if (!form.fieldName.trim()) nextErrors.fieldName = 'Field name is required'
    if (form.conditionType === 'regex' && !form.regex.trim()) nextErrors.regex = 'Regex pattern is required'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const conditionValue: Record<string, unknown> = {}
    if (form.conditionType === 'regex') conditionValue.regex = form.regex
    if (form.conditionType === 'range') { if (form.min) conditionValue.min = Number(form.min); if (form.max) conditionValue.max = Number(form.max) }
    setSaving(true)
    try {
      const res = await fetch('/api/validation-rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, fieldName: form.fieldName.trim(), conditionValue }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error || 'Could not create rule')
        return
      }
      toast.success('Rule created')
      setOpen(false)
      setForm(INITIAL_VALIDATION_FORM)
      load()
    } catch {
      toast.error('Could not create rule')
    } finally {
      setSaving(false)
    }
  }

  const del = async (id: string) => {
    try {
      const res = await fetch(`/api/validation-rules/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error || 'Could not delete rule')
        return
      }
      toast.success('Rule deleted')
      load()
    } catch {
      toast.error('Could not delete rule')
    }
  }

  const performDelete = async () => {
    if (!confirm) return
    const { id } = confirm
    setConfirm(null)
    await del(id)
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div><CardTitle className="text-base">Validation Rules</CardTitle><CardDescription>Enforce data quality on save</CardDescription></div>
        <Button size="sm" onClick={() => { setErrors({}); setOpen(true) }}><Plus className="mr-1 size-4" /> New Validation Rule</Button>
      </CardHeader>
      <CardContent className="p-0">
        {!rules ? <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div> :
         rules.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No rules yet</div> :
         <ul className="divide-y">{rules.map((r) => (
           <li key={r.id} className="flex items-center gap-3 p-4">
             <div className="flex-1">
               <div className="flex items-center gap-2">
                 <span className="font-medium">{r.fieldName}</span>
                 <Badge variant="outline" className="text-[10px]">{r.conditionType}</Badge>
                 <Badge variant="outline" className={`text-[10px] ${r.errorSeverity === 'error' ? 'border-destructive/40 text-destructive' : 'border-amber-500/40 text-amber-600'}`}>{r.errorSeverity}</Badge>
               </div>
               <p className="text-xs text-muted-foreground">{r.errorMessage} · {r.targetModel} · {r.triggerOn}</p>
             </div>
             <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setConfirm({ id: r.id, name: r.fieldName })} aria-label="Delete rule" title="Delete rule"><Trash2 className="size-4" /></Button>
           </li>
         ))}</ul>}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setErrors({}) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New validation rule</DialogTitle>
            <DialogDescription>Enforce data quality when records are saved</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="validation-model">Model</Label>
                <Select value={form.targetModel} onValueChange={(v) => setForm({ ...form, targetModel: v })}>
                  <SelectTrigger id="validation-model"><SelectValue /></SelectTrigger>
                  <SelectContent>{MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="validation-field">Field</Label>
                <Input id="validation-field" value={form.fieldName} onChange={(e) => { setForm({ ...form, fieldName: e.target.value }); if (errors.fieldName) setErrors({ ...errors, fieldName: undefined }) }} />
                {errors.fieldName && <p className="mt-1 text-xs text-destructive">{errors.fieldName}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="validation-condition">Condition</Label>
                <Select value={form.conditionType} onValueChange={(v) => setForm({ ...form, conditionType: v })}>
                  <SelectTrigger id="validation-condition"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="required">Required</SelectItem><SelectItem value="regex">Regex</SelectItem><SelectItem value="range">Range</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="validation-severity">Severity</Label>
                <Select value={form.errorSeverity} onValueChange={(v) => setForm({ ...form, errorSeverity: v })}>
                  <SelectTrigger id="validation-severity"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="error">Error</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            {form.conditionType === 'regex' && (
              <div>
                <Label htmlFor="validation-regex">Regex pattern</Label>
                <Input id="validation-regex" value={form.regex} onChange={(e) => { setForm({ ...form, regex: e.target.value }); if (errors.regex) setErrors({ ...errors, regex: undefined }) }} placeholder="^[^@]+@[^@]+\.[^@]+$" />
                {errors.regex && <p className="mt-1 text-xs text-destructive">{errors.regex}</p>}
              </div>
            )}
            {form.conditionType === 'range' && <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="validation-min">Min</Label><Input id="validation-min" type="number" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} /></div><div><Label htmlFor="validation-max">Max</Label><Input id="validation-max" type="number" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} /></div></div>}
            <div>
              <Label htmlFor="validation-message">Error message</Label>
              <Input id="validation-message" value={form.errorMessage} onChange={(e) => setForm({ ...form, errorMessage: e.target.value })} placeholder="Amount must be greater than 0" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation (exact product copy) */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete validation rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {confirm?.name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete} className={buttonVariants({ variant: 'destructive' })}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Assignment Rules (enhanced builder — lives inside a right-side Sheet)
// ---------------------------------------------------------------------------

type AssignMode = 'round_robin' | 'lead_balance' | 'territory' | 'specific_user' | 'specific_role'

interface CriteriaRowUI {
  kind: 'row'
  key: string
  field: string
  operator: string
  value: string
}

/**
 * Nested condition group (spec 3.2) — serialized as `{logic, rows}` inside
 * `rows`. A group's rows may again contain groups, up to MAX_GROUP_DEPTH_UI.
 */
interface CriteriaGroupUI {
  kind: 'group'
  key: string
  logic: 'AND' | 'OR'
  rows: CriteriaEntryUI[]
}

type CriteriaEntryUI = CriteriaRowUI | CriteriaGroupUI

/** Deepest group nesting the builder offers — mirrors the API sanitizer cap
 *  (a group inside a group = 2 levels; deeper is rejected server-side). */
const MAX_GROUP_DEPTH_UI = 2

interface AssignmentRuleRow {
  id: string
  name: string | null
  targetModel: string
  criteria: string
  strategy: string
  assignTo: string
  assignToRole: string | null
  fallbackUserId: string | null
  territoryField: string | null
  isActive: boolean
  priority: number | null
  logic: string | null
  onlyIfUnassigned: boolean
  notifyEmail: boolean
  notifyInApp: boolean
  lastTriggeredAt: string | null
  triggerCount: number
  createdAt: string
}

const ASSIGN_MODELS = [
  { value: 'contact', label: 'Contacts' }, { value: 'lead', label: 'Leads' },
  { value: 'deal', label: 'Deals' }, { value: 'account', label: 'Accounts' },
]

type FieldKind = 'picklist' | 'number' | 'text' | 'date'
const FIELD_CATALOG: { field: string; label: string; kind: FieldKind; options?: string[] }[] = [
  { field: 'recruiterTag', label: 'Recruiter Tag', kind: 'picklist', options: ['New Recruiter', 'Existing Recruiter'] },
  { field: 'premiumStatus', label: 'Premium Status', kind: 'picklist', options: ['Free', 'Paid'] },
  { field: 'listingSubtype', label: 'Listing Subtype', kind: 'picklist', options: ['Jobs', 'Internships'] },
  { field: 'reasonableFitPct', label: 'Reasonable Fit %', kind: 'number' },
  { field: 'csmNextStep', label: 'CSM Next Step', kind: 'picklist', options: CSM_STEPS.map((s) => s.value) },
  { field: 'csmRecruiterType', label: 'CSM Recruiter Type', kind: 'picklist', options: ['First Time', 'Existing', 'New'] },
  { field: 'leadSource', label: 'Lead Source', kind: 'text' },
  { field: 'company', label: 'Company', kind: 'text' },
  // CSM date fields — date-kind criteria (spec 3.3): the engine evaluates the
  // date operators against TODAY's server-local day boundaries.
  { field: 'lastReachedOutAt', label: 'Last Reached-Out Time', kind: 'date' },
  { field: 'csmNextCallDate', label: 'CSM Next Call Date', kind: 'date' },
]

const OPERATORS_BY_KIND: Record<FieldKind, string[]> = {
  picklist: ['is', 'is_not', 'is_any_of'],
  number: ['greater_than', 'less_than', 'equals', 'between'],
  text: ['is', 'is_not', 'contains', 'does_not_contain'],
  // Date operator set mirrors the API sanitizer's accepted is_today /
  // is_before / is_after / is_overdue operators.
  date: ['is_today', 'is_before', 'is_after', 'is_overdue'],
}

/** Fallback operator set for rows whose field is not in the catalog (rules
 *  created before this catalog existed) — keeps them editable/round-trippable. */
const FALLBACK_OPERATORS = ['is', 'is_not', 'contains', 'does_not_contain']

const OPERATOR_LABELS: Record<string, string> = {
  is: 'is', is_not: 'is not', is_any_of: 'is any of', equals: 'equals',
  greater_than: 'greater than', less_than: 'less than', between: 'between',
  contains: 'contains', does_not_contain: 'does not contain',
  is_today: 'is today', is_before: 'is before today', is_after: 'is after today', is_overdue: 'is overdue',
}

const ASSIGN_MODES: { value: AssignMode; label: string }[] = [
  { value: 'round_robin', label: 'Round Robin' },
  { value: 'lead_balance', label: 'Load Balanced' },
  { value: 'territory', label: 'Territory' },
  { value: 'specific_user', label: 'Specific User' },
  { value: 'specific_role', label: 'Specific Role' },
]

const STRATEGY_LABELS: Record<string, string> = {
  round_robin: 'Round Robin', lead_balance: 'Load Balanced', territory: 'Territory', custom: 'Custom',
}

const fieldMeta = (field: string) => FIELD_CATALOG.find((f) => f.field === field)
const fieldLabel = (field: string) => fieldMeta(field)?.label ?? field
const opLabel = (op: string) => OPERATOR_LABELS[op] ?? op
const firstOperator = (field: string) => {
  const meta = fieldMeta(field)
  return meta ? OPERATORS_BY_KIND[meta.kind][0] : 'is'
}
/** Operators whose value input is a date comparison (no row value needed). */
const VALUELESS_OPERATORS = new Set(['is_today', 'is_before', 'is_after', 'is_overdue'])
const needsValue = (op: string) => !VALUELESS_OPERATORS.has(op)

const rowError = (row: CriteriaRowUI): string => {
  if (!row.field) return 'Pick a field'
  if (!row.operator) return 'Pick an operator'
  if (needsValue(row.operator) && row.value.trim() === '') return 'Enter a value'
  return ''
}

/** Inline message shown inside a group box (only the group's OWN emptiness —
 *  nested groups render their own messages to avoid double reporting). */
const groupError = (group: CriteriaGroupUI): string =>
  group.rows.length === 0 ? 'Group needs at least one condition' : ''

/** Recursive validity check used to gate saving (mirrors the API sanitizer:
 *  invalid leaf rows and empty groups must never reach the server). */
const entriesHaveErrors = (entries: CriteriaEntryUI[]): boolean =>
  entries.some((e) =>
    e.kind === 'row' ? rowError(e) !== '' : e.rows.length === 0 || entriesHaveErrors(e.rows),
  )

/** "2h ago"-style relative time for the Last Triggered column. */
const relativeTime = (iso: string | null): string => {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Never'
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleString()
}

/** Parsed criteria entry: a leaf row or a nested group (display-only shape). */
type ParsedEntry = { field: string; operator: string; value: string } | { logic: string; rows: ParsedEntry[] }

interface ParsedCriteria {
  rows: ParsedEntry[]
  logic: string
  flatEntries: [string, unknown][]
}

const isParsedGroup = (e: ParsedEntry): e is { logic: string; rows: ParsedEntry[] } => 'rows' in e

const parseEntry = (r: unknown): ParsedEntry | null => {
  if (!r || typeof r !== 'object') return null
  const e = r as Record<string, unknown>
  if (Array.isArray(e.rows)) {
    return {
      logic: String(e.logic ?? 'AND').toUpperCase(),
      rows: e.rows.map(parseEntry).filter((x): x is ParsedEntry => x !== null),
    }
  }
  return {
    field: String(e.field ?? ''),
    operator: String(e.operator ?? ''),
    value: e.value === undefined || e.value === null ? '' : String(e.value),
  }
}

/** Parse persisted criteria JSON into a display-friendly shape. Legacy flat
 *  maps (zero groups) and structured criteria with nested `{logic, rows}`
 *  groups both hydrate: legacy → flatEntries, structured → rows (groups kept
 *  intact so the list view can print them with their own AND/OR). */
const parseCriteria = (raw: unknown): ParsedCriteria => {
  try {
    const c = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {})
    if (c && typeof c === 'object' && Array.isArray((c as { rows?: unknown }).rows)) {
      const rows = ((c as { rows: unknown[] }).rows).map(parseEntry).filter((x): x is ParsedEntry => x !== null)
      return { rows, logic: String((c as { logic?: unknown }).logic ?? 'AND').toUpperCase(), flatEntries: [] }
    }
    return { rows: [], logic: 'AND', flatEntries: Object.entries(c as Record<string, unknown>) }
  } catch {
    return { rows: [], logic: 'AND', flatEntries: [] }
  }
}

// ---------------------------------------------------------------------------
// Criteria tree helpers + shared row renderer (ONE implementation used for
// top-level rows and rows inside nested groups)
// ---------------------------------------------------------------------------

const newRowUI = (key: string): CriteriaRowUI => {
  const first = FIELD_CATALOG[0]
  return { kind: 'row', key, field: first.field, operator: firstOperator(first.field), value: '' }
}
const newGroupUI = (key: string, rowKey: string): CriteriaGroupUI => ({
  kind: 'group',
  key,
  logic: 'AND',
  rows: [newRowUI(rowKey)],
})

/** Patch one leaf row anywhere in the tree. Pure + keyed: untouched siblings
 *  keep their state, and callers use functional setState so updates never
 *  reset each other. */
function patchRowInEntries(entries: CriteriaEntryUI[], key: string, patch: Partial<CriteriaRowUI>): CriteriaEntryUI[] {
  return entries.map((e) => {
    if (e.kind === 'row') return e.key === key ? { ...e, ...patch } : e
    return { ...e, rows: patchRowInEntries(e.rows, key, patch) }
  })
}

/** Remove any entry (row or group, by key) anywhere in the tree. Removing the
 *  last row of a group leaves an empty group — save-time validation blocks
 *  that (matching the API sanitizer's "groups need ≥1 row" rule). */
function removeEntryFromEntries(entries: CriteriaEntryUI[], key: string): CriteriaEntryUI[] {
  return entries
    .filter((e) => e.key !== key)
    .map((e) => (e.kind === 'group' ? { ...e, rows: removeEntryFromEntries(e.rows, key) } : e))
}

/** Append an entry to the top level (groupKey null) or inside a group. */
function addEntryToEntries(entries: CriteriaEntryUI[], groupKey: string | null, entry: CriteriaEntryUI): CriteriaEntryUI[] {
  if (groupKey === null) return [...entries, entry]
  return entries.map((e) => {
    if (e.kind !== 'group') return e
    if (e.key === groupKey) return { ...e, rows: [...e.rows, entry] }
    return { ...e, rows: addEntryToEntries(e.rows, groupKey, entry) }
  })
}

function setGroupLogicInEntries(entries: CriteriaEntryUI[], groupKey: string, logic: 'AND' | 'OR'): CriteriaEntryUI[] {
  return entries.map((e) => {
    if (e.kind !== 'group') return e
    if (e.key === groupKey) return { ...e, logic }
    return { ...e, rows: setGroupLogicInEntries(e.rows, groupKey, logic) }
  })
}

/** AND/OR pill between two consecutive entries (top-level or inside a group). */
function LogicDivider(props: { logic: string; onToggle: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-1">
      <span className="h-px flex-1 bg-border" />
      <button
        type="button"
        onClick={props.onToggle}
        className="rounded-full border px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:bg-muted"
        title="Toggle AND / OR"
      >
        {props.logic}
      </button>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

/**
 * The ONE condition-row renderer: [Field▼][Operator▼][Value editor]+remove,
 * with the per-kind value editors (picklist select / between / text / number
 * / date). Used for top-level rows and rows inside groups alike. Fields not
 * in the catalog fall back to text operators + a plain text value input.
 */
function CriteriaRowEditor(props: {
  row: CriteriaRowUI
  index: number
  count: number
  logic: string
  onToggleLogic: () => void
  onUpdate: (key: string, patch: Partial<CriteriaRowUI>) => void
  onFieldChange: (key: string, field: string) => void
  onRemove: (key: string) => void
}) {
  const { row, index, count, logic } = props
  const meta = fieldMeta(row.field)
  const err = rowError(row)
  const operatorOptions = meta ? OPERATORS_BY_KIND[meta.kind] : FALLBACK_OPERATORS
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={row.field} onValueChange={(v) => props.onFieldChange(row.key, v)}>
          <SelectTrigger className="w-full sm:w-[180px]" aria-label="Condition field"><SelectValue placeholder="Field" /></SelectTrigger>
          <SelectContent>{FIELD_CATALOG.map((f) => <SelectItem key={f.field} value={f.field}>{f.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={row.operator} onValueChange={(v) => props.onUpdate(row.key, { operator: v })}>
          <SelectTrigger className="w-full sm:w-[160px]" aria-label="Condition operator"><SelectValue placeholder="Operator" /></SelectTrigger>
          <SelectContent>
            {operatorOptions.map((op) => (
              <SelectItem key={op} value={op}>{opLabel(op)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {meta && meta.kind === 'date' && (row.operator === 'is_before' || row.operator === 'is_after') && (
          // Date criteria: is_before/is_after get a date input; the engine
          // itself compares date fields against TODAY server-side, so the
          // value is persisted for compatibility (no input for is_today /
          // is_overdue).
          <Input
            type="date"
            className="min-w-[140px] flex-1"
            aria-label="Date"
            value={row.value}
            onChange={(e) => props.onUpdate(row.key, { value: e.target.value })}
          />
        )}
        {meta && meta.kind !== 'date' && needsValue(row.operator) && (
          meta.kind === 'picklist' && row.operator !== 'is_any_of' ? (
            <Select value={row.value || undefined} onValueChange={(v) => props.onUpdate(row.key, { value: v })}>
              <SelectTrigger className="min-w-[140px] flex-1"><SelectValue placeholder="Value" /></SelectTrigger>
              <SelectContent>{(meta.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          ) : row.operator === 'between' ? (
            <div className="flex min-w-[140px] flex-1 items-center gap-1.5">
              <Input type="number" className="flex-1" placeholder="Min" value={row.value.split(',')[0] ?? ''} onChange={(e) => props.onUpdate(row.key, { value: `${e.target.value},${row.value.split(',')[1] ?? ''}` })} />
              <span className="text-xs text-muted-foreground">and</span>
              <Input type="number" className="flex-1" placeholder="Max" value={row.value.split(',')[1] ?? ''} onChange={(e) => props.onUpdate(row.key, { value: `${row.value.split(',')[0] ?? ''},${e.target.value}` })} />
            </div>
          ) : (
            <Input
              type={meta.kind === 'number' ? 'number' : 'text'}
              className="min-w-[140px] flex-1"
              placeholder={row.operator === 'is_any_of' ? 'Value 1, Value 2' : 'Value'}
              value={row.value}
              onChange={(e) => props.onUpdate(row.key, { value: e.target.value })}
            />
          )
        )}
        {!meta && needsValue(row.operator) && (
          <Input
            type="text"
            className="min-w-[140px] flex-1"
            aria-label="Value"
            placeholder="Value"
            value={row.value}
            onChange={(e) => props.onUpdate(row.key, { value: e.target.value })}
          />
        )}
        <Button variant="ghost" size="icon" className="size-8 shrink-0 text-destructive" onClick={() => props.onRemove(row.key)} aria-label="Remove condition">
          <Trash2 className="size-4" />
        </Button>
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
      {index < count - 1 && <LogicDivider logic={logic} onToggle={props.onToggleLogic} />}
    </div>
  )
}

/** A criteria group: bordered box with its own AND/OR, its own rows (and —
 *  while depth allows — nested groups), Add condition / Add group / remove. */
function CriteriaGroupEditor(props: {
  group: CriteriaGroupUI
  depth: number // 1 = top-level group, 2 = group inside a group (max)
  onUpdateRow: (key: string, patch: Partial<CriteriaRowUI>) => void
  onFieldChange: (key: string, field: string) => void
  onRemoveEntry: (key: string) => void
  onAddRow: (groupKey: string) => void
  onAddGroup: (groupKey: string) => void
  onSetGroupLogic: (groupKey: string, logic: 'AND' | 'OR') => void
}) {
  const { group, depth } = props
  const err = groupError(group)
  const toggleGroupLogic = () => props.onSetGroupLogic(group.key, group.logic === 'AND' ? 'OR' : 'AND')
  return (
    <div className="space-y-2 rounded-lg border border-dashed bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {depth > 1 ? 'Nested group' : 'Group'} · match {group.logic === 'OR' ? 'ANY' : 'ALL'} inside
        </span>
        <div className="flex items-center gap-1">
          {group.rows.length > 1 && (
            <div className="flex items-center gap-1 rounded-lg border p-1">
              {(['AND', 'OR'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => props.onSetGroupLogic(group.key, l)}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${group.logic === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => props.onRemoveEntry(group.key)} aria-label="Remove group" title="Remove group">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {group.rows.map((child, idx) =>
        child.kind === 'row' ? (
          <CriteriaRowEditor
            key={child.key}
            row={child}
            index={idx}
            count={group.rows.length}
            logic={group.logic}
            onToggleLogic={toggleGroupLogic}
            onUpdate={props.onUpdateRow}
            onFieldChange={props.onFieldChange}
            onRemove={props.onRemoveEntry}
          />
        ) : (
          <div key={child.key}>
            <CriteriaGroupEditor {...props} group={child} depth={depth + 1} />
            {idx < group.rows.length - 1 && <LogicDivider logic={group.logic} onToggle={toggleGroupLogic} />}
          </div>
        ),
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => props.onAddRow(group.key)}>
          <Plus className="mr-1 size-4" /> Add condition
        </Button>
        {depth < MAX_GROUP_DEPTH_UI && (
          <Button type="button" variant="outline" size="sm" onClick={() => props.onAddGroup(group.key)}>
            <Plus className="mr-1 size-4" /> Add group
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assignment pre-fill helpers (edit mode)
// ---------------------------------------------------------------------------

const assignModelLabel = (m: string) => ASSIGN_MODELS.find((x) => x.value === m)?.label ?? m

const parseAssignIds = (raw: unknown): string[] => {
  try {
    const ids: unknown = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

/** Persisted criteria JSON → editable entries (groups kept; legacy flat maps
 *  become plain "is" rows). */
function criteriaToEntries(raw: unknown, keySeq: { current: number }): { entries: CriteriaEntryUI[]; logic: 'AND' | 'OR' } {
  const c = parseCriteria(raw)
  const fromEntry = (e: ParsedEntry): CriteriaEntryUI => {
    if (isParsedGroup(e)) {
      return { kind: 'group', key: `group-${++keySeq.current}`, logic: e.logic === 'OR' ? 'OR' : 'AND', rows: e.rows.map(fromEntry) }
    }
    return { kind: 'row', key: `row-${++keySeq.current}`, field: e.field || FIELD_CATALOG[0].field, operator: e.operator || 'is', value: e.value }
  }
  const entries = c.rows.map(fromEntry)
  for (const [k, v] of c.flatEntries) {
    entries.push({ kind: 'row', key: `row-${++keySeq.current}`, field: k || FIELD_CATALOG[0].field, operator: 'is', value: v === undefined || v === null ? '' : String(v) })
  }
  return { entries, logic: c.logic === 'OR' ? 'OR' : 'AND' }
}

/** Derive the builder's assign mode from a persisted rule row. */
const assignModeFromRule = (r: AssignmentRuleRow): AssignMode => {
  if (r.assignToRole) return 'specific_role'
  if (r.strategy === 'lead_balance') return 'lead_balance'
  if (r.strategy === 'territory') return 'territory'
  if (r.strategy === 'round_robin' && parseAssignIds(r.assignTo).length === 1) return 'specific_user'
  return 'round_robin'
}

/**
 * The full 3-section assignment builder (Rule Info / Criteria / Assignment
 * Action), moved verbatim into a right-side Sheet. Opens empty ("new") or
 * pre-filled from an existing rule ("edit"); Save POSTs or PATCHes.
 */
function AssignmentRuleSheet(props: {
  open: boolean
  editing: AssignmentRuleRow | null
  members: { id: string; name: string; email: string }[]
  roles: { id: string; name: string }[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { open, editing, members, roles, onOpenChange, onSaved } = props
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<{ name?: string; pool?: string; role?: string }>({})

  // Section 1 — Rule Info
  const [name, setName] = React.useState('')
  const [targetModel, setTargetModel] = React.useState('contact')
  const [isActive, setIsActive] = React.useState(true)
  const [priority, setPriority] = React.useState('')

  // Section 2 — Criteria / Conditions (stable entry keys: adding never resets;
  // entries mix leaf rows and nested groups `{logic, rows}`).
  const [entries, setEntries] = React.useState<CriteriaEntryUI[]>([])
  const [logic, setLogic] = React.useState<'AND' | 'OR'>('AND')
  const keySeq = React.useRef(0)

  // Section 3 — Assignment Action
  const [assignMode, setAssignMode] = React.useState<AssignMode>('round_robin')
  // Owner pool for rotation strategies and the Specific User picker. Empty
  // pool means "all active org members" (the engine's fallback).
  const [pool, setPool] = React.useState<string[]>([])
  const [assignToRole, setAssignToRole] = React.useState('')
  const [notifyEmail, setNotifyEmail] = React.useState(false)
  const [notifyInApp, setNotifyInApp] = React.useState(false)
  const [onlyIfUnassigned, setOnlyIfUnassigned] = React.useState(false)

  const nameById = React.useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members])

  // Reset (new) or pre-fill (edit) every time the sheet opens.
  React.useEffect(() => {
    if (!open) return
    setErrors({})
    setSaving(false)
    keySeq.current = 0
    if (editing) {
      setName(editing.name ?? '')
      setTargetModel(editing.targetModel)
      setIsActive(editing.isActive)
      setPriority(editing.priority !== null && editing.priority !== undefined ? String(editing.priority) : '')
      const prefill = criteriaToEntries(editing.criteria, keySeq)
      setEntries(prefill.entries)
      setLogic(prefill.logic)
      setAssignMode(assignModeFromRule(editing))
      setPool(editing.assignToRole ? [] : parseAssignIds(editing.assignTo))
      setAssignToRole(editing.assignToRole ?? '')
      setNotifyEmail(editing.notifyEmail)
      setNotifyInApp(editing.notifyInApp)
      setOnlyIfUnassigned(editing.onlyIfUnassigned)
    } else {
      setName(''); setTargetModel('contact'); setIsActive(true); setPriority('')
      setEntries([]); setLogic('AND')
      setAssignMode('round_robin'); setPool([]); setAssignToRole('')
      setNotifyEmail(false); setNotifyInApp(false); setOnlyIfUnassigned(false)
    }
  }, [open, editing])

  // ---- criteria entry handlers (stable keys — existing entries keep state)
  const addRow = () => {
    setEntries((es) => addEntryToEntries(es, null, newRowUI(`row-${++keySeq.current}`)))
  }
  const addGroup = () => {
    setEntries((es) => addEntryToEntries(es, null, newGroupUI(`group-${++keySeq.current}`, `row-${++keySeq.current}`)))
  }
  const addRowToGroup = (groupKey: string) => {
    setEntries((es) => addEntryToEntries(es, groupKey, newRowUI(`row-${++keySeq.current}`)))
  }
  const addSubGroup = (groupKey: string) => {
    setEntries((es) => addEntryToEntries(es, groupKey, newGroupUI(`group-${++keySeq.current}`, `row-${++keySeq.current}`)))
  }
  const updateRow = (key: string, patch: Partial<CriteriaRowUI>) => {
    setEntries((es) => patchRowInEntries(es, key, patch))
  }
  const removeEntry = (key: string) => setEntries((es) => removeEntryFromEntries(es, key))
  const changeRowField = (key: string, field: string) => {
    updateRow(key, { field, operator: firstOperator(field), value: '' })
  }
  const updateGroupLogic = (groupKey: string, groupLogic: 'AND' | 'OR') => {
    setEntries((es) => setGroupLogicInEntries(es, groupKey, groupLogic))
  }

  const togglePoolMember = (id: string) => {
    setPool((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  const save = async () => {
    const nextErrors: { name?: string; pool?: string; role?: string } = {}
    if (!name.trim()) nextErrors.name = 'Rule name is required'
    if (assignMode === 'specific_user' && pool.length === 0) nextErrors.pool = 'Select at least one member'
    if (assignMode === 'specific_role' && !assignToRole) nextErrors.role = 'Select a role'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    if (entriesHaveErrors(entries)) return // inline row/group errors already shown

    // Groups serialize as {logic, rows} nested inside rows (leaves as before).
    const serializeEntry = (e: CriteriaEntryUI): Record<string, unknown> =>
      e.kind === 'row'
        ? { field: e.field, operator: e.operator, value: e.value }
        : { logic: e.logic, rows: e.rows.map(serializeEntry) }

    const payload = {
      name: name.trim(),
      targetModel,
      isActive,
      priority: priority.trim() === '' ? null : Number(priority),
      criteria: entries.length === 0
        ? {}
        : { rows: entries.map(serializeEntry), logic },
      // specific_user/specific_role ride on round_robin — the pool (or role)
      // restricts who rotates; a length-1 pool IS the specific user.
      strategy: assignMode === 'specific_user' || assignMode === 'specific_role' ? 'round_robin' : assignMode,
      assignTo: assignMode === 'specific_role' ? [] : pool,
      assignToRole: assignMode === 'specific_role' ? assignToRole : null,
      logic,
      onlyIfUnassigned,
      notifyEmail,
      notifyInApp,
    }
    setSaving(true)
    try {
      const res = await fetch(editing ? `/api/assignment-rules/${editing.id}` : '/api/assignment-rules', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error || (editing ? 'Could not update rule' : 'Could not create rule'))
        return
      }
      toast.success(editing ? 'Rule updated' : 'Rule created')
      onSaved()
    } catch {
      toast.error('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const modelLabel = assignModelLabel
  const usesPool = assignMode !== 'specific_role'
  const isSpecificUser = assignMode === 'specific_user'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>{editing ? 'Edit assignment rule' : 'New Rule Assignment'}</SheetTitle>
          <SheetDescription>
            {editing ? 'Update conditions, rotation and notifications' : 'Auto-assign matching records to reps'}
          </SheetDescription>
        </SheetHeader>

        <div className="assignment-scroll flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-4">
            {/* ------------------------- Section 1 ------------------------- */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Section 1 · Rule Info</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="assignment-rule-name">Rule name</Label>
                  <Input id="assignment-rule-name" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }) }} placeholder="e.g. New recruiters to Priya" />
                  {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
                </div>
                <div>
                  <Label>Module</Label>
                  <Select value={targetModel} onValueChange={setTargetModel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ASSIGN_MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="assignment-rule-priority">Priority</Label>
                  <Input id="assignment-rule-priority" type="number" min={0} value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="—" />
                  <p className="mt-1 text-xs text-muted-foreground">Lower runs first · empty = after prioritized rules</p>
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Switch id="assignment-rule-active" checked={isActive} onCheckedChange={setIsActive} />
                  <Label htmlFor="assignment-rule-active" className="cursor-pointer font-normal">Active (rule fires as soon as saved)</Label>
                </div>
              </CardContent>
            </Card>

            {/* ------------------------- Section 2 ------------------------- */}
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <div>
                  <CardTitle className="text-sm font-medium">Section 2 · Criteria / Conditions</CardTitle>
                  <CardDescription>
                    {entries.length === 0
                      ? 'No conditions — this rule matches ALL records (catch-all)'
                      : `Match ${logic === 'OR' ? 'ANY' : 'ALL'} of the conditions below`}
                  </CardDescription>
                </div>
                {entries.length > 1 && (
                  <div className="flex items-center gap-1 rounded-lg border p-1">
                    {(['AND', 'OR'] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setLogic(l)}
                        className={`rounded px-2 py-0.5 text-xs font-medium ${logic === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {entries.map((entry, idx) =>
                  entry.kind === 'row' ? (
                    <CriteriaRowEditor
                      key={entry.key}
                      row={entry}
                      index={idx}
                      count={entries.length}
                      logic={logic}
                      onToggleLogic={() => setLogic(logic === 'AND' ? 'OR' : 'AND')}
                      onUpdate={updateRow}
                      onFieldChange={changeRowField}
                      onRemove={removeEntry}
                    />
                  ) : (
                    <div key={entry.key}>
                      <CriteriaGroupEditor
                        group={entry}
                        depth={1}
                        onUpdateRow={updateRow}
                        onFieldChange={changeRowField}
                        onRemoveEntry={removeEntry}
                        onAddRow={addRowToGroup}
                        onAddGroup={addSubGroup}
                        onSetGroupLogic={updateGroupLogic}
                      />
                      {idx < entries.length - 1 && (
                        <LogicDivider logic={logic} onToggle={() => setLogic(logic === 'AND' ? 'OR' : 'AND')} />
                      )}
                    </div>
                  ),
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={addRow}>
                    <Plus className="mr-1 size-4" /> Add condition
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={addGroup}>
                    <Plus className="mr-1 size-4" /> Add group
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* ------------------------- Section 3 ------------------------- */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Section 3 · Assignment Action</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Assign to</Label>
                    <Select value={assignMode} onValueChange={(v) => { setAssignMode(v as AssignMode); setErrors({}) }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ASSIGN_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {assignMode === 'specific_role' && (
                    <div>
                      <Label>Role</Label>
                      <Select value={assignToRole || undefined} onValueChange={setAssignToRole}>
                        <SelectTrigger><SelectValue placeholder="Pick a role" /></SelectTrigger>
                        <SelectContent>
                          {roles.length === 0
                            ? <div className="px-3 py-2 text-xs text-muted-foreground">No roles found</div>
                            : roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {errors.role && <p className="mt-1 text-xs text-destructive">{errors.role}</p>}
                    </div>
                  )}
                  {assignMode === 'territory' && (
                    <div className="flex items-end">
                      <p className="text-xs text-muted-foreground">Records are bucketed by a stable hash of the Company field.</p>
                    </div>
                  )}
                </div>

                {usesPool && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <Label>
                        {isSpecificUser ? 'Pick the user' : 'Owner pool'}
                        {pool.length > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">({pool.length} selected)</span>}
                      </Label>
                      <button type="button" className="text-xs text-primary hover:underline" onClick={() => setPool(pool.length === members.length ? [] : members.map((m) => m.id))}>
                        {pool.length === members.length && members.length > 0 ? 'Clear all' : 'Select all'}
                      </button>
                    </div>
                    <div className="assignment-scroll grid max-h-40 gap-1.5 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
                      {members.length === 0 ? <p className="text-xs text-muted-foreground">No active members found.</p> : members.map((m) => (
                        <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/40">
                          <input
                            type="checkbox"
                            checked={pool.includes(m.id)}
                            onChange={() => togglePoolMember(m.id)}
                            className="size-4 accent-[var(--primary)]"
                          />
                          <span className="truncate">{m.name}</span>
                          <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                        </label>
                      ))}
                    </div>
                    {isSpecificUser
                      ? (pool.length === 0
                          ? <p className="mt-1 text-xs text-destructive">{errors.pool ?? 'Select at least one member — records go to that user.'}</p>
                          : <p className="mt-1 text-xs text-muted-foreground">Every matching record is assigned to {pool.map((id) => nameById.get(id)).filter(Boolean).join(', ')}.</p>)
                      : (pool.length === 0 && <p className="mt-1 text-xs text-muted-foreground">No one selected — new records rotate across every active member.</p>)}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                    Notify by email
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={notifyInApp} onChange={(e) => setNotifyInApp(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                    Notify in-app
                  </label>
                  <div className="flex items-center gap-2">
                    <Switch id="assignment-only-unassigned" checked={onlyIfUnassigned} onCheckedChange={setOnlyIfUnassigned} />
                    <Label htmlFor="assignment-only-unassigned" className="cursor-pointer font-normal">Only if owner is empty</Label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <SheetFooter className="flex-row items-center justify-between gap-3 border-t">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {entries.length === 0 ? 'Saves as a catch-all rule for every new record in this module.' : `Saves for new ${modelLabel(targetModel).toLowerCase()} records matching the conditions.`}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Save rule'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function AssignmentRules() {
  const [rules, setRules] = React.useState<AssignmentRuleRow[] | null>(null)
  const [members, setMembers] = React.useState<{ id: string; name: string; email: string }[]>([])
  const [roles, setRoles] = React.useState<{ id: string; name: string }[]>([])
  const [sheet, setSheet] = React.useState<{ open: boolean; editing: AssignmentRuleRow | null }>({ open: false, editing: null })
  const [confirm, setConfirm] = React.useState<{ type: 'toggle' | 'delete'; rule: AssignmentRuleRow } | null>(null)

  const load = React.useCallback(async () => {
    const [r, m, rolesRes] = await Promise.all([
      fetch('/api/assignment-rules', { cache: 'no-store' }).then((res) => res.json()),
      fetch('/api/crm/members', { cache: 'no-store' }).then((res) => res.json()),
      fetch('/api/roles', { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
    ])
    setRules(r.rules ?? [])
    setMembers(m.members ?? [])
    setRoles(rolesRes?.roles ?? [])
  }, [])
  React.useEffect(() => { load() }, [load])

  const nameById = React.useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members])
  const roleNameById = React.useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles])

  const performConfirm = async () => {
    if (!confirm) return
    const { type, rule } = confirm
    setConfirm(null)
    try {
      const res = type === 'delete'
        ? await fetch(`/api/assignment-rules/${rule.id}`, { method: 'DELETE' })
        : await fetch(`/api/assignment-rules/${rule.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: !rule.isActive }),
          })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error || 'Something went wrong')
        return
      }
      toast.success(type === 'delete' ? 'Rule deleted' : rule.isActive ? 'Rule deactivated' : 'Rule activated')
      load()
    } catch {
      toast.error('Something went wrong')
    }
  }

  // ---- list helpers -------------------------------------------------------

  // Mirror the engine's execution order: priority asc (nulls last) →
  // specificity desc → createdAt asc.
  const sortedRules = React.useMemo(() => {
    if (!rules) return null
    // Mirror the engine's criteriaSpecificity: leaves count 1, groups sum
    // their leaves.
    const leafCount = (e: ParsedEntry): number =>
      isParsedGroup(e) ? e.rows.reduce((n, x) => n + leafCount(x), 0) : 1
    const specificity = (raw: unknown) => {
      const c = parseCriteria(raw)
      return c.rows.length > 0 ? c.rows.reduce((n, e) => n + leafCount(e), 0) : c.flatEntries.length
    }
    return [...rules].sort((a, b) => {
      const pa = a.priority ?? Number.POSITIVE_INFINITY
      const pb = b.priority ?? Number.POSITIVE_INFINITY
      if (pa !== pb) return pa - pb
      const sa = specificity(a.criteria)
      const sb = specificity(b.criteria)
      if (sa !== sb) return sb - sa
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
  }, [rules])

  // Pretty-print criteria ("{}" → "All records"; rows → "Field op value";
  // groups → "(A AND B)" with the group's own logic).
  const labelEntry = (e: ParsedEntry): string =>
    isParsedGroup(e)
      ? `(${e.rows.map(labelEntry).join(e.logic === 'OR' ? ' OR ' : ' AND ')})`
      : `${fieldLabel(e.field)} ${opLabel(e.operator)}${needsValue(e.operator) ? ` ${e.value}` : ''}`.trim()
  const criteriaLabel = (raw: unknown) => {
    const c = parseCriteria(raw)
    if (c.rows.length > 0) {
      const joiner = c.logic === 'OR' ? ' OR ' : ' AND '
      return c.rows.map(labelEntry).join(joiner)
    }
    if (c.flatEntries.length === 0) return 'All records'
    return c.flatEntries.map(([k, v]) => `${fieldLabel(k)}: ${v}`).join(' · ')
  }

  // Resolve a rule's assignTo JSON array of user ids → display names.
  const poolNames = (rawAssignTo: unknown): { names: string[]; total: number } => {
    try {
      const ids: string[] = typeof rawAssignTo === 'string' ? JSON.parse(rawAssignTo || '[]') : (rawAssignTo as string[]) ?? []
      const names = ids.map((id) => nameById.get(id) ?? null).filter(Boolean) as string[]
      return { names, total: ids.length }
    } catch { return { names: [], total: 0 } }
  }

  const modelLabel = assignModelLabel

  return (
    <div className="space-y-4">
      <style>{`
        .assignment-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .assignment-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 9999px; }
        .assignment-scroll { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
      `}</style>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div><CardTitle className="text-base">Assignment Rules</CardTitle><CardDescription>Auto-assign records to reps — conditions, rotation and notifications</CardDescription></div>
          <Button size="sm" onClick={() => setSheet({ open: true, editing: null })}><Plus className="mr-1 size-4" /> New Rule Assignment</Button>
        </CardHeader>
        <CardContent className="p-0">
          {/* --------------------------- List ---------------------------- */}
          {!sortedRules ? <div className="p-4"><Skeleton className="h-20 w-full" /></div> :
           sortedRules.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No assignment rules yet</p> :
           <ul className="assignment-scroll max-h-96 divide-y overflow-y-auto rounded-lg border">{sortedRules.map((r) => {
            const { names, total } = poolNames(r.assignTo)
            const roleName = r.assignToRole ? roleNameById.get(r.assignToRole) ?? 'Unknown role' : null
            return (
              <li key={r.id} className="flex items-start gap-3 p-3">
                <Zap className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{r.name || STRATEGY_LABELS[r.strategy] || r.strategy}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${r.isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                      <span className={`size-1.5 rounded-full ${r.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
                      {r.isActive ? 'Active' : 'Inactive'}
                    </span>
                    {r.priority !== null && r.priority !== undefined && (
                      <Badge variant="outline" className="text-[10px]" title="Priority — lower runs first">P{r.priority}</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] capitalize">{modelLabel(r.targetModel)}</Badge>
                    <span className="text-xs text-muted-foreground">{criteriaLabel(r.criteria)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={roleName ? `Role: ${roleName}` : names.join(', ')}>
                    <span className="font-medium text-foreground/70">Assigns to:</span>{' '}
                    {roleName
                      ? `Role — ${roleName}`
                      : total === 0 ? 'All active members' : names.length > 0 ? names.join(', ') : `${total} member${total === 1 ? '' : 's'}`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">Last triggered:</span> {relativeTime(r.lastTriggeredAt)}
                    <span className="mx-1.5">·</span>
                    <span className="font-medium text-foreground/70">Times triggered:</span> {r.triggerCount ?? 0}
                    {r.onlyIfUnassigned && (<><span className="mx-1.5">·</span>only when owner is empty</>)}
                    {(r.notifyEmail || r.notifyInApp) && (<><span className="mx-1.5">·</span>notifies: {[r.notifyEmail ? 'email' : null, r.notifyInApp ? 'in-app' : null].filter(Boolean).join(' + ')}</>)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => setSheet({ open: true, editing: r })} aria-label="Edit rule" title="Edit rule">
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => setConfirm({ type: 'toggle', rule: r })} aria-label={r.isActive ? 'Deactivate rule' : 'Activate rule'} title={r.isActive ? 'Deactivate' : 'Activate'}>
                    <Power className={`size-3.5 ${r.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`} />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => setConfirm({ type: 'delete', rule: r })} aria-label="Delete rule">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            )
          })}</ul>}
        </CardContent>
      </Card>

      {/* Builder sheet — new + edit */}
      <AssignmentRuleSheet
        open={sheet.open}
        editing={sheet.editing}
        members={members}
        roles={roles}
        onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))}
        onSaved={() => { setSheet((s) => ({ ...s, open: false })); load() }}
      />

      {/* Confirm dialog for deactivate/activate and delete */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.type === 'delete'
                ? 'Delete assignment rule?'
                : confirm?.rule.isActive ? 'Deactivate this rule?' : 'Activate this rule?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.type === 'delete'
                ? `Are you sure you want to delete ${confirm.rule.name || STRATEGY_LABELS[confirm.rule.strategy] || confirm.rule.strategy}? This action cannot be undone.`
                : confirm?.rule.isActive
                  ? 'The rule stops matching new records immediately. You can activate it again later.'
                  : 'The rule will start matching new records again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={performConfirm}
              className={confirm?.type === 'delete' ? buttonVariants({ variant: 'destructive' }) : undefined}
            >
              {confirm?.type === 'delete' ? 'Delete' : confirm?.rule.isActive ? 'Deactivate' : 'Activate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Escalation Rules (Sheet-based builder with conditions, assignee, priority,
// thresholds, fallback actions and status)
// ---------------------------------------------------------------------------

interface EscalationConditionUI {
  key: string
  field: string
  operator: string
  value: string
}

interface EscalationRuleRow {
  id: string
  targetModel: string
  conditions: string | null
  timeLimitHours: number
  escalateTo: string
  assigneeUserId: string | null
  assigneeRoleId: string | null
  priority: string | null
  warnAfterHours: number | null
  fallbackActions: string | null
  action: string
  isActive: boolean
  createdAt: string
}

const ESCALATION_OPERATORS = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'greater_than', label: 'greater than' },
]

const ESCALATION_PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const ESCALATION_FALLBACKS = [
  { value: 'notify_admin', label: 'Notify admin' },
  { value: 'reassign_role', label: 'Reassign to role' },
  { value: 'create_task', label: 'Create follow-up task' },
]

const parseConditions = (raw: unknown): { field: string; operator: string; value: string }[] => {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw
    if (!Array.isArray(arr)) return []
    return arr
      .map((e) => {
        const o = (e ?? {}) as Record<string, unknown>
        return {
          field: String(o.field ?? '').trim(),
          operator: String(o.operator ?? 'is').trim(),
          value: o.value === undefined || o.value === null ? '' : String(o.value),
        }
      })
      .filter((c) => c.field)
  } catch { return [] }
}

const parseFallbacks = (raw: unknown): string[] => {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

/** "Recruiter Tag is New Recruiter AND Reasonable Fit % greater than 50" */
const conditionsSummary = (raw: unknown): string => {
  const rows = parseConditions(raw)
  if (rows.length === 0) return ''
  return rows.map((c) => `${fieldLabel(c.field)} ${opLabel(c.operator)}${c.value ? ` ${c.value}` : ''}`).join(' AND ')
}

/**
 * Escalation rule form inside a right-side Sheet: target module, optional
 * trigger conditions, assignee (user or role), priority, warn/escalate
 * thresholds, fallback actions and an Active switch. Opens empty (new) or
 * pre-filled (edit); Save POSTs or PATCHes.
 */
function EscalationRuleSheet(props: {
  open: boolean
  editing: EscalationRuleRow | null
  users: { id: string; name: string; email: string }[]
  roles: { id: string; name: string }[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { open, editing, users, roles, onOpenChange, onSaved } = props
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<{ limit?: string; warn?: string; assignee?: string }>({})

  const [targetModel, setTargetModel] = React.useState('lead')
  const [conditions, setConditions] = React.useState<EscalationConditionUI[]>([])
  const [assigneeType, setAssigneeType] = React.useState<'none' | 'user' | 'role'>('none')
  const [assigneeUserId, setAssigneeUserId] = React.useState('')
  const [assigneeRoleId, setAssigneeRoleId] = React.useState('')
  const [priority, setPriority] = React.useState('')
  const [action, setAction] = React.useState('notify')
  const [warnAfterHours, setWarnAfterHours] = React.useState('')
  const [timeLimitHours, setTimeLimitHours] = React.useState('24')
  const [fallbacks, setFallbacks] = React.useState<string[]>([])
  const [isActive, setIsActive] = React.useState(true)
  const keySeq = React.useRef(0)

  // Reset (new) or pre-fill (edit) every time the sheet opens.
  React.useEffect(() => {
    if (!open) return
    setErrors({})
    setSaving(false)
    keySeq.current = 0
    if (editing) {
      setTargetModel(editing.targetModel)
      setConditions(parseConditions(editing.conditions).map((c) => ({ key: `cond-${++keySeq.current}`, ...c })))
      setAssigneeType(editing.assigneeUserId ? 'user' : editing.assigneeRoleId ? 'role' : 'none')
      setAssigneeUserId(editing.assigneeUserId ?? '')
      setAssigneeRoleId(editing.assigneeRoleId ?? '')
      setPriority(editing.priority ?? '')
      setAction(editing.action || 'notify')
      setWarnAfterHours(editing.warnAfterHours !== null && editing.warnAfterHours !== undefined ? String(editing.warnAfterHours) : '')
      setTimeLimitHours(String(editing.timeLimitHours))
      setFallbacks(parseFallbacks(editing.fallbackActions))
      setIsActive(editing.isActive)
    } else {
      setTargetModel('lead'); setConditions([])
      setAssigneeType('none'); setAssigneeUserId(''); setAssigneeRoleId('')
      setPriority(''); setAction('notify')
      setWarnAfterHours(''); setTimeLimitHours('24')
      setFallbacks([]); setIsActive(true)
    }
  }, [open, editing])

  const addCondition = () => {
    const first = FIELD_CATALOG[0]
    setConditions((cs) => [...cs, { key: `cond-${++keySeq.current}`, field: first.field, operator: 'is', value: '' }])
  }
  const updateCondition = (key: string, patch: Partial<EscalationConditionUI>) => {
    setConditions((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  }
  const removeCondition = (key: string) => setConditions((cs) => cs.filter((c) => c.key !== key))
  const toggleFallback = (value: string) => {
    setFallbacks((f) => (f.includes(value) ? f.filter((x) => x !== value) : [...f, value]))
  }

  const save = async () => {
    const nextErrors: { limit?: string; warn?: string; assignee?: string } = {}
    const limit = Number(timeLimitHours)
    if (timeLimitHours.trim() === '' || !Number.isInteger(limit) || limit < 1) {
      nextErrors.limit = 'Enter a whole number of hours (min 1)'
    }
    let warn: number | null = null
    if (warnAfterHours.trim() !== '') {
      warn = Number(warnAfterHours)
      if (!Number.isInteger(warn) || warn < 0) nextErrors.warn = 'Enter a whole number of hours'
      else if (!nextErrors.limit && warn > limit) nextErrors.warn = 'Must be ≤ the escalation threshold'
    }
    if (assigneeType === 'user' && !assigneeUserId) nextErrors.assignee = 'Select a user'
    if (assigneeType === 'role' && !assigneeRoleId) nextErrors.assignee = 'Select a role'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const payload = {
      targetModel,
      timeLimitHours: limit,
      action,
      conditions: conditions.map(({ field, operator, value }) => ({ field, operator, value })),
      assigneeUserId: assigneeType === 'user' ? assigneeUserId : null,
      assigneeRoleId: assigneeType === 'role' ? assigneeRoleId : null,
      priority: priority || null,
      warnAfterHours: warn,
      fallbackActions: fallbacks,
      isActive,
    }
    setSaving(true)
    try {
      const res = await fetch(editing ? `/api/escalation-rules/${editing.id}` : '/api/escalation-rules', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error || (editing ? 'Could not update rule' : 'Could not create rule'))
        return
      }
      toast.success(editing ? 'Rule updated' : 'Rule created')
      onSaved()
    } catch {
      toast.error('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>{editing ? 'Edit escalation rule' : 'New Escalation Rule'}</SheetTitle>
          <SheetDescription>
            {editing ? 'Update triggers, assignee and timing' : 'Escalate stale records that match the conditions'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-4">
            {/* ----------------------- Rule info ------------------------- */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Section 1 · Rule Info</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Model</Label>
                  <Select value={targetModel} onValueChange={setTargetModel}>
                    <SelectTrigger aria-label="Target module"><SelectValue /></SelectTrigger>
                    <SelectContent>{MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Priority</Label>
                  <Select value={priority || undefined} onValueChange={setPriority}>
                    <SelectTrigger aria-label="Priority level"><SelectValue placeholder="Select priority" /></SelectTrigger>
                    <SelectContent>{ESCALATION_PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="escalation-action">Action</Label>
                  <Select value={action} onValueChange={setAction}>
                    <SelectTrigger id="escalation-action"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="notify">Notify</SelectItem><SelectItem value="reassign">Reassign</SelectItem><SelectItem value="both">Both</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Switch id="escalation-rule-active" checked={isActive} onCheckedChange={setIsActive} />
                  <Label htmlFor="escalation-rule-active" className="cursor-pointer font-normal">Active</Label>
                </div>
              </CardContent>
            </Card>

            {/* -------------------- Trigger conditions -------------------- */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Section 2 · Trigger Conditions</CardTitle>
                <CardDescription>
                  {conditions.length === 0
                    ? 'Optional — empty conditions escalate every record in this module'
                    : 'Escalate only records matching all conditions below'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {conditions.map((c, idx) => (
                  <div key={c.key}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={c.field} onValueChange={(v) => updateCondition(c.key, { field: v, value: '' })}>
                        <SelectTrigger className="w-full sm:w-[180px]" aria-label="Condition field"><SelectValue placeholder="Field" /></SelectTrigger>
                        <SelectContent>{FIELD_CATALOG.map((f) => <SelectItem key={f.field} value={f.field}>{f.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={c.operator} onValueChange={(v) => updateCondition(c.key, { operator: v })}>
                        <SelectTrigger className="w-full sm:w-[150px]" aria-label="Condition operator"><SelectValue placeholder="Operator" /></SelectTrigger>
                        <SelectContent>{ESCALATION_OPERATORS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input
                        type="text"
                        className="min-w-[140px] flex-1"
                        aria-label="Condition value"
                        placeholder="Value"
                        value={c.value}
                        onChange={(e) => updateCondition(c.key, { value: e.target.value })}
                      />
                      <Button variant="ghost" size="icon" className="size-8 shrink-0 text-destructive" onClick={() => removeCondition(c.key)} aria-label="Remove condition">
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {idx < conditions.length - 1 && (
                      <div className="mt-2 flex items-center gap-1">
                        <span className="h-px flex-1 bg-border" />
                        <span className="rounded-full border px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">AND</span>
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addCondition}>
                  <Plus className="mr-1 size-4" /> Add condition
                </Button>
              </CardContent>
            </Card>

            {/* -------------------- Assignee + timing --------------------- */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Section 3 · Assignee &amp; Timing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Escalate to</Label>
                    <Select value={assigneeType} onValueChange={(v) => { setAssigneeType(v as 'none' | 'user' | 'role'); setErrors((e) => ({ ...e, assignee: undefined })) }}>
                      <SelectTrigger aria-label="Assignee type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No assignee</SelectItem>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="role">Role</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {assigneeType === 'user' && (
                    <div>
                      <Label>User</Label>
                      <Select value={assigneeUserId || undefined} onValueChange={(v) => { setAssigneeUserId(v); setErrors((e) => ({ ...e, assignee: undefined })) }}>
                        <SelectTrigger><SelectValue placeholder="Pick a user" /></SelectTrigger>
                        <SelectContent>
                          {users.length === 0
                            ? <div className="px-3 py-2 text-xs text-muted-foreground">No users found</div>
                            : users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {errors.assignee && <p className="mt-1 text-xs text-destructive">{errors.assignee}</p>}
                    </div>
                  )}
                  {assigneeType === 'role' && (
                    <div>
                      <Label>Role</Label>
                      <Select value={assigneeRoleId || undefined} onValueChange={(v) => { setAssigneeRoleId(v); setErrors((e) => ({ ...e, assignee: undefined })) }}>
                        <SelectTrigger><SelectValue placeholder="Pick a role" /></SelectTrigger>
                        <SelectContent>
                          {roles.length === 0
                            ? <div className="px-3 py-2 text-xs text-muted-foreground">No roles found</div>
                            : roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {errors.assignee && <p className="mt-1 text-xs text-destructive">{errors.assignee}</p>}
                    </div>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="escalation-warn">Warn after (hours)</Label>
                    <Input id="escalation-warn" type="number" min={0} value={warnAfterHours} onChange={(e) => { setWarnAfterHours(e.target.value); if (errors.warn) setErrors((errs) => ({ ...errs, warn: undefined })) }} placeholder="—" />
                    {errors.warn && <p className="mt-1 text-xs text-destructive">{errors.warn}</p>}
                  </div>
                  <div>
                    <Label htmlFor="escalation-limit">Escalate after (hours)</Label>
                    <Input id="escalation-limit" type="number" min={1} value={timeLimitHours} onChange={(e) => { setTimeLimitHours(e.target.value); if (errors.limit) setErrors((errs) => ({ ...errs, limit: undefined })) }} />
                    {errors.limit && <p className="mt-1 text-xs text-destructive">{errors.limit}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* --------------------- Fallback actions --------------------- */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Section 4 · Fallback Actions</CardTitle>
                <CardDescription>Extra steps taken alongside the escalation</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {ESCALATION_FALLBACKS.map((f) => (
                  <label key={f.value} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={fallbacks.includes(f.value)}
                      onChange={() => toggleFallback(f.value)}
                      className="size-4 accent-[var(--primary)]"
                    />
                    {f.label}
                  </label>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        <SheetFooter className="flex-row items-center justify-end gap-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save rule'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function EscalationRules() {
  const [rules, setRules] = React.useState<EscalationRuleRow[] | null>(null)
  const [logs, setLogs] = React.useState<any[] | null>(null)
  const [users, setUsers] = React.useState<{ id: string; name: string; email: string }[]>([])
  const [roles, setRoles] = React.useState<{ id: string; name: string }[]>([])
  const [sheet, setSheet] = React.useState<{ open: boolean; editing: EscalationRuleRow | null }>({ open: false, editing: null })
  const [confirm, setConfirm] = React.useState<EscalationRuleRow | null>(null)

  const load = React.useCallback(async () => {
    const [r, l, u, rolesRes] = await Promise.all([
      // includeInactive: inactive rules stay visible so they can be reactivated
      fetch('/api/escalation-rules?includeInactive=true', { cache: 'no-store' }).then((res) => res.json()),
      fetch('/api/escalation-rules?logs=true', { cache: 'no-store' }).then((res) => res.json()),
      fetch('/api/users', { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
      fetch('/api/roles', { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
    ])
    setRules(r.rules ?? [])
    setLogs(l.logs ?? [])
    setUsers(u?.users ?? [])
    setRoles(rolesRes?.roles ?? [])
  }, [])
  React.useEffect(() => { load() }, [load])

  const userNameById = React.useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])
  const roleNameById = React.useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles])

  const performDelete = async () => {
    if (!confirm) return
    const rule = confirm
    setConfirm(null)
    try {
      const res = await fetch(`/api/escalation-rules/${rule.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error || 'Could not delete rule')
        return
      }
      toast.success('Rule deleted')
      load()
    } catch {
      toast.error('Could not delete rule')
    }
  }

  // Human-readable label used in the list and the delete confirmation.
  const escRuleLabel = (r: EscalationRuleRow) => {
    const bits = [escModelLabel(r.targetModel)]
    if (r.warnAfterHours !== null && r.warnAfterHours !== undefined) bits.push(`warn after ${r.warnAfterHours}h`)
    bits.push(`escalate after ${r.timeLimitHours}h`)
    return bits.join(' · ')
  }

  const assigneeLabel = (r: EscalationRuleRow): string | null => {
    if (r.assigneeUserId) return userNameById.get(r.assigneeUserId) ?? 'Unknown user'
    if (r.assigneeRoleId) return `Role — ${roleNameById.get(r.assigneeRoleId) ?? 'Unknown role'}`
    return null
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div><CardTitle className="text-base">Escalation Rules</CardTitle><CardDescription>Auto-escalate stale records</CardDescription></div>
          <Button size="sm" onClick={() => setSheet({ open: true, editing: null })}><Plus className="mr-1 size-4" /> New Escalation Rule</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!rules ? <Skeleton className="h-20 w-full" /> :
           rules.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No escalation rules yet</p> :
           <ul className="divide-y rounded-lg border">{rules.map((r) => {
            const assignee = assigneeLabel(r)
            const conditions = conditionsSummary(r.conditions)
            const fallbacks = parseFallbacks(r.fallbackActions)
            return (
              <li key={r.id} className="flex items-start gap-3 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{escRuleLabel(r)}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${r.isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                      <span className={`size-1.5 rounded-full ${r.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
                      {r.isActive ? 'Active' : 'Inactive'}
                    </span>
                    {r.priority && <Badge variant="outline" className="text-[10px] capitalize">{r.priority}</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">Action:</span> <span className="capitalize">{r.action}</span>
                    {assignee && (<><span className="mx-1.5">·</span><span className="font-medium text-foreground/70">Escalates to:</span> {assignee}</>)}
                    {conditions && (<><span className="mx-1.5">·</span>{conditions}</>)}
                    {fallbacks.length > 0 && (<><span className="mx-1.5">·</span>fallback: {fallbacks.map((f) => ESCALATION_FALLBACKS.find((x) => x.value === f)?.label ?? f).join(', ')}</>)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => setSheet({ open: true, editing: r })} aria-label="Edit rule" title="Edit rule">
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => setConfirm(r)} aria-label="Delete rule" title="Delete rule">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            )
          })}</ul>}
        </CardContent>
      </Card>

      <EscalationRuleSheet
        open={sheet.open}
        editing={sheet.editing}
        users={users}
        roles={roles}
        onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))}
        onSaved={() => { setSheet((s) => ({ ...s, open: false })); load() }}
      />

      {/* Delete confirmation (exact product copy) */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete escalation rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {confirm ? escRuleLabel(confirm) : ''}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete} className={buttonVariants({ variant: 'destructive' })}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {logs && logs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Escalation history</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">{logs.slice(0, 10).map((l) => (
              <li key={l.id} className="flex items-center gap-3 p-3 text-sm">
                <AlertTriangle className="size-4 text-amber-500" />
                <span className="flex-1">{l.recordModule}:{l.recordId.slice(-8)}</span>
                <Badge variant="outline" className="text-[10px]">{l.actionTaken}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</span>
              </li>
            ))}</ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
