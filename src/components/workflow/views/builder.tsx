'use client'

import * as React from 'react'
import {
  Plus, Trash2, Play, Copy, Power, Zap, Clock, CheckCircle2, XCircle, ArrowRight,
  Mail, Edit, Bell, Tag, Users, Globe, Calendar, Send, UserPlus, Timer, TrendingUp,
  ListChecks, ClipboardCheck, MailPlus, BellRing, History, Loader2,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { safeJsonParse } from '@/components/safe-json'
import { CSM_VALUES } from '@/lib/csm'
import { toast } from 'sonner'
import type { LucideIcon } from 'lucide-react'

// Existing 9 triggers stay first and unchanged; the two new ones are appended.
const TRIGGER_TYPES = [
  { value: 'record_create', label: 'Record Created' },
  { value: 'record_update', label: 'Record Updated' },
  { value: 'record_delete', label: 'Record Deleted' },
  { value: 'field_change', label: 'Field Changed' },
  { value: 'schedule', label: 'Schedule (Cron)' },
  { value: 'manual', label: 'Manual Button' },
  { value: 'approval_approved', label: 'Approval Approved' },
  { value: 'approval_rejected', label: 'Approval Rejected' },
  { value: 'blueprint_transition', label: 'Blueprint Transition' },
  { value: 'record_create_or_update', label: 'Record Created or Edited' },
  { value: 'date_based', label: 'Date-Based' },
]

// Existing action types stay first; new CSM/owner/webhook actions are appended.
// `models` restricts an action to the record types it can actually run on
// (contact-only CSM actions etc.); absent = available on every model.
type ModelValue = 'lead' | 'contact' | 'deal' | 'account'
interface ActionTypeDef { value: string; label: string; icon: LucideIcon; models?: ModelValue[] }
const ACTION_TYPES: ActionTypeDef[] = [
  { value: 'send_email', label: 'Send Email', icon: Mail },
  { value: 'update_field', label: 'Update Field', icon: Edit },
  { value: 'create_task', label: 'Create Task', icon: CheckCircle2 },
  { value: 'alert', label: 'Alert', icon: Bell },
  { value: 'add_tag', label: 'Add Tag', icon: Tag },
  { value: 'remove_tag', label: 'Remove Tag', icon: Tag },
  { value: 'notify_team', label: 'Notify Team', icon: Users },
  { value: 'assign_record', label: 'Assign Record', icon: Users },
  { value: 'webhook', label: 'Webhook', icon: Globe },
  { value: 'delay', label: 'Delay', icon: Clock },
  { value: 'if_else', label: 'If/Else Branch', icon: ArrowRight },
  { value: 'update_csm_next_step', label: 'Set CSM Next Step', icon: ListChecks, models: ['contact'] },
  { value: 'update_csm_status', label: 'Set CSM Status', icon: ClipboardCheck, models: ['contact'] },
  { value: 'send_email_owner', label: 'Email Record Owner', icon: MailPlus },
  { value: 'notify_inapp_owner', label: 'Notify Owner In-App', icon: BellRing },
  { value: 'create_task_owner', label: 'Create Task for Owner', icon: UserPlus },
  { value: 'set_last_reached_out', label: 'Stamp Last Reached-Out', icon: Timer, models: ['contact'] },
  { value: 'increment_reachouts', label: 'Increment Reachouts', icon: TrendingUp, models: ['contact'] },
  { value: 'send_email_contact', label: 'Email the Contact', icon: Send, models: ['contact'] },
]

const MODELS = [
  { value: 'lead', label: 'Lead' }, { value: 'deal', label: 'Deal' },
  { value: 'contact', label: 'Contact' }, { value: 'account', label: 'Account' },
]

type FieldType = 'picklist' | 'number' | 'percent' | 'date' | 'text'

interface FieldDef { label: string; api: string; type: FieldType; options?: readonly string[]; models?: ModelValue[] }

/** Condition field catalog: label → api name, type, picklist options.
 *  `models` marks fields that exist on only one record type (CSM fields are
 *  contact-only; company/leadSource are lead-only) so the pickers can filter. */
const FIELD_CATALOG: FieldDef[] = [
  { label: 'CSM Next Step', api: 'csmNextStep', type: 'picklist', options: CSM_VALUES, models: ['contact'] },
  { label: 'CSM Recruiter Type', api: 'csmRecruiterType', type: 'picklist', options: ['First Time', 'Existing', 'New'], models: ['contact'] },
  { label: 'CSM Status', api: 'csmStatus', type: 'text', models: ['contact'] },
  { label: 'Reasonable Fit %', api: 'reasonableFitPct', type: 'percent', models: ['contact'] },
  { label: 'Premium Status', api: 'premiumStatus', type: 'picklist', options: ['Free', 'Paid'], models: ['contact'] },
  { label: 'Recruiter Tag', api: 'recruiterTag', type: 'picklist', options: ['New Recruiter', 'Existing Recruiter'], models: ['contact'] },
  { label: 'Listing Subtype', api: 'listingSubtype', type: 'picklist', options: ['Jobs', 'Internships'], models: ['contact'] },
  { label: 'Total Reachouts Done', api: 'totalReachoutsDone', type: 'number', models: ['contact'] },
  { label: 'Last Reached-Out Time', api: 'lastReachedOutAt', type: 'date', models: ['contact'] },
  { label: 'CSM Next Call Date', api: 'csmNextCallDate', type: 'date', models: ['contact'] },
  { label: 'Lead Source', api: 'leadSource', type: 'text', models: ['lead'] },
  { label: 'Company', api: 'company', type: 'text', models: ['lead'] },
]

/** Fields/action types offered for a record type (no filter when none set). */
const fieldsForModel = (model: string): FieldDef[] =>
  FIELD_CATALOG.filter((f) => !f.models || !model || f.models.includes(model as ModelValue))
const actionTypesForModel = (model: string): ActionTypeDef[] =>
  ACTION_TYPES.filter((a) => !a.models || !model || a.models.includes(model as ModelValue))

const OPERATORS: Record<FieldType, { value: string; label: string }[]> = {
  picklist: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'is_any_of', label: 'is any of' },
  ],
  number: [
    { value: 'equals', label: 'equals' },
    { value: 'greater_than', label: 'greater than' },
    { value: 'less_than', label: 'less than' },
    { value: 'between', label: 'between' },
  ],
  percent: [
    { value: 'equals', label: 'equals' },
    { value: 'greater_than', label: 'greater than' },
    { value: 'less_than', label: 'less than' },
    { value: 'between', label: 'between' },
  ],
  date: [
    { value: 'is_today', label: 'is today' },
    { value: 'is_before', label: 'is before' },
    { value: 'is_after', label: 'is after' },
    { value: 'is_overdue', label: 'is overdue' },
    // Additive relative-date operator (engine: workflow-triggers.ts `is_before_days_ago`).
    { value: 'is_before_days_ago', label: 'is before X days ago' },
  ],
  text: [
    { value: 'is', label: 'is' },
    { value: 'contains', label: 'contains' },
    { value: 'does_not_contain', label: 'does not contain' },
  ],
}

const OPERATOR_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(OPERATORS).flat().map((o) => [o.value, o.label]),
)

const NO_VALUE_OPERATORS = ['is_today', 'is_overdue']

interface CondRow { key: string; field: string; operator: string; value: string }

function rowError(r: CondRow): string | null {
  if (!r.field) return 'Field required'
  if (!r.operator) return 'Operator required'
  if (NO_VALUE_OPERATORS.includes(r.operator)) return null
  if (r.operator === 'between') {
    const parts = r.value.split(',').map((s) => s.trim())
    if (parts.length !== 2 || parts.some((p) => p === '' || Number.isNaN(Number(p)))) return 'Min and max numbers required (min,max)'
    return null
  }
  // Relative date operator: value is X = number of days (numeric), not a date.
  if (r.operator === 'is_before_days_ago') {
    if (!r.value.trim()) return 'Number of days required'
    if (Number.isNaN(Number(r.value))) return 'Numeric value required'
    return null
  }
  if (!r.value.trim()) return 'Value required'
  const def = FIELD_CATALOG.find((f) => f.api === r.field)
  if ((def?.type === 'number' || def?.type === 'percent') && Number.isNaN(Number(r.value))) return 'Numeric value required'
  if (def?.type === 'date' && Number.isNaN(Date.parse(r.value))) return 'Valid date required'
  return null
}

interface Action { id: string; actionType: string; order: number; config: string }
interface Execution {
  id: string; status: string; createdAt: string; completedAt: string | null
  errorMessage: string | null; actionsExecuted: string; targetModule: string; targetId: string
}
interface Workflow {
  id: string; name: string; triggerType: string; triggerModel: string | null; triggerConditions: string | null
  isActive: boolean; runCount: number; errorCount: number; lastRunAt: string | null
  actions: Action[]; executions?: Execution[]; _count?: { executions: number }
}

let rowKeySeq = 0
const nextRowKey = () => `row-${++rowKeySeq}-${Date.now().toString(36)}`

export function WorkflowBuilderView() {
  const [workflows, setWorkflows] = React.useState<Workflow[] | null>(null)
  const [deleteConfirm, setDeleteConfirm] = React.useState<Workflow | null>(null)
  const [deletingWorkflow, setDeletingWorkflow] = React.useState(false)
  const [selected, setSelected] = React.useState<Workflow | null>(null)
  const [newOpen, setNewOpen] = React.useState(false)
  const [newWf, setNewWf] = React.useState({ name: '', triggerType: 'record_create', triggerModel: 'lead' })
  const [actionConfig, setActionConfig] = React.useState({
    actionType: 'send_email', title: '', message: '', field: '', value: '', tag: '', dueInDays: '1',
    url: '', method: 'POST', subject: '', csmStep: 'Day 0', csmStatus: '',
    // send_email recipients: explicit address(es) and/or the record-email sentinel.
    to: '', recipient: '',
  })

  // --- Editor drafts: LIFTED to the parent so tab switching never resets them ---
  const [tab, setTab] = React.useState('trigger')
  const [triggerDraft, setTriggerDraft] = React.useState({
    triggerType: 'record_create', triggerModel: 'lead', fieldChangeField: '',
    dateField: '', offsetDays: '0', direction: 'before' as 'before' | 'after',
  })
  const [condRows, setCondRows] = React.useState<CondRow[]>([])
  const [condLogic, setCondLogic] = React.useState<'AND' | 'OR'>('AND')
  const [saveOpen, setSaveOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [runDatedBusy, setRunDatedBusy] = React.useState(false)

  // Auto-select the first workflow once per mount (a ref keeps `load` free of
  // the `selected` dependency, so selecting a workflow never refetches the list).
  const autoSelectedRef = React.useRef(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/workflows', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed')
      setWorkflows(data.workflows ?? [])
      if (data.workflows?.[0] && !autoSelectedRef.current) {
        autoSelectedRef.current = true
        loadDetail(data.workflows[0].id)
      }
    } catch { setWorkflows([]) }
  }, [])

  const deleteWorkflow = async () => {
    const wf = deleteConfirm
    if (!wf) return
    setDeletingWorkflow(true)
    try {
      const res = await fetch(`/api/workflows/${wf.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || 'Failed to delete workflow')
      }
      toast.success('Workflow deleted')
      setDeleteConfirm(null)
      if (selected?.id === wf.id) setSelected(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete workflow')
    } finally {
      setDeletingWorkflow(false)
    }
  }

  const loadDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/workflows/${id}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load workflow')
      setSelected(data.workflow ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the workflow')
      setSelected(null)
    }
  }

  React.useEffect(() => { load() }, [load])

  // Seed the lifted drafts from the newly-selected workflow (once per workflow id,
  // so refreshes after a save do NOT clobber in-progress edits).
  const seededForRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!selected || seededForRef.current === selected.id) return
    seededForRef.current = selected.id
    const cfg = safeJsonParse<Record<string, unknown>>(selected.triggerConditions ?? '{}', {})
    setTriggerDraft({
      triggerType: selected.triggerType,
      triggerModel: selected.triggerModel ?? 'lead',
      fieldChangeField: typeof cfg.field === 'string' ? cfg.field : '',
      dateField: typeof cfg.dateField === 'string' ? cfg.dateField : '',
      offsetDays: cfg.offsetDays != null && !Number.isNaN(Number(cfg.offsetDays)) ? String(cfg.offsetDays) : '0',
      direction: cfg.direction === 'after' ? 'after' : 'before',
    })
    const rows = Array.isArray(cfg.rows) ? (cfg.rows as Record<string, unknown>[]) : []
    setCondRows(rows.map((r) => ({
      key: nextRowKey(),
      field: typeof r?.field === 'string' ? r.field : '',
      operator: typeof r?.operator === 'string' ? r.operator : '',
      value: Array.isArray(r?.value) ? r.value.map(String).join(',') : typeof r?.value === 'string' ? r.value : '',
    })))
    setCondLogic(cfg.logic === 'OR' ? 'OR' : 'AND')
  }, [selected])

  const create = async () => {
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWf),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Workflow created')
      setNewOpen(false); setNewWf({ name: '', triggerType: 'record_create', triggerModel: 'lead' })
      autoSelectedRef.current = true
      if (data.id) loadDetail(data.id)
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  const toggleActive = async (id: string, active: boolean) => {
    try {
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', active }),
      })
      if (!res.ok) throw new Error('Toggle failed')
      toast.success(active ? 'Activated' : 'Deactivated')
      loadDetail(id); load()
    } catch { toast.error('Could not change the workflow state') }
  }

  const duplicate = async (id: string) => {
    try {
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'duplicate' }),
      })
      if (!res.ok) throw new Error('Duplicate failed')
      toast.success('Duplicated')
      load()
    } catch { toast.error('Could not duplicate the workflow') }
  }

  // --- Conditions editor helpers (array state with stable keys — rows never reset each other) ---
  const updateRow = (key: string, patch: Partial<CondRow>) =>
    setCondRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const addRow = () =>
    setCondRows((rows) => [...rows, { key: nextRowKey(), field: '', operator: '', value: '' }])
  const removeRow = (key: string) =>
    setCondRows((rows) => rows.filter((r) => r.key !== key))
  const onRowFieldChange = (key: string, field: string) => {
    const def = FIELD_CATALOG.find((f) => f.api === field)
    setCondRows((rows) => rows.map((r) => (r.key === key
      ? { ...r, field, operator: def ? OPERATORS[def.type][0].value : '', value: '' }
      : r)))
  }
  const onAnyOfToggle = (row: CondRow, option: string) => {
    const selectedOpts = row.value.split(',').map((s) => s.trim()).filter(Boolean)
    const next = selectedOpts.includes(option)
      ? selectedOpts.filter((o) => o !== option)
      : [...selectedOpts, option]
    updateRow(row.key, { value: next.join(',') })
  }

  // --- Save (trigger + conditions merged into one triggerConditions payload) ---
  const buildTriggerConditions = (): Record<string, unknown> => {
    const base = safeJsonParse<Record<string, unknown>>(selected?.triggerConditions ?? '{}', {})
    const merged: Record<string, unknown> = { ...base }
    merged.rows = condRows
      .filter((r) => r.field && r.operator)
      .map((r) => ({ field: r.field, operator: r.operator, value: r.value }))
    merged.logic = condLogic
    if (triggerDraft.triggerType === 'date_based') {
      merged.dateField = triggerDraft.dateField
      merged.offsetDays = Number(triggerDraft.offsetDays) || 0
      merged.direction = triggerDraft.direction
    } else {
      delete merged.dateField; delete merged.offsetDays; delete merged.direction
    }
    if (triggerDraft.triggerType === 'field_change' && triggerDraft.fieldChangeField) {
      merged.field = triggerDraft.fieldChangeField
    } else {
      delete merged.field
    }
    return merged
  }

  const saveInvalid =
    condRows.some((r) => rowError(r) !== null) ||
    (triggerDraft.triggerType === 'date_based' && !triggerDraft.dateField.trim()) ||
    (triggerDraft.triggerType === 'field_change' && !triggerDraft.fieldChangeField)

  const saveChanges = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch(`/api/workflows/${selected.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerType: triggerDraft.triggerType,
          triggerModel: triggerDraft.triggerModel,
          triggerConditions: buildTriggerConditions(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Save failed')
      toast.success('Workflow saved')
      setSaveOpen(false)
      loadDetail(selected.id); load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the workflow')
    } finally { setSaving(false) }
  }

  const addAction = async () => {
    if (!selected) return
    const t = actionConfig.actionType
    const config: Record<string, unknown> = {}
    if (t === 'create_task' || t === 'create_task_owner') {
      if (actionConfig.title) config.title = actionConfig.title
      // Keep the raw string in the input; parse only a real number here so
      // clearing the field does not collapse to a bogus 0-day due date.
      const due = String(actionConfig.dueInDays ?? '').trim()
      if (due !== '' && Number.isFinite(Number(due))) config.dueInDays = Number(due)
    } else if (t === 'alert' || t === 'notify_team' || t === 'notify_inapp_owner') {
      if (actionConfig.message) config.message = actionConfig.message
    } else if (t === 'update_field') {
      if (actionConfig.field) { config.field = actionConfig.field; config.value = actionConfig.value }
    } else if (t === 'add_tag' || t === 'remove_tag') {
      if (actionConfig.tag) config.tag = actionConfig.tag
    } else if (t === 'update_csm_next_step') {
      config.value = actionConfig.csmStep
    } else if (t === 'update_csm_status') {
      if (actionConfig.csmStatus) config.value = actionConfig.csmStatus
    } else if (t === 'send_email_owner' || t === 'send_email_contact') {
      if (actionConfig.subject) config.subject = actionConfig.subject
      if (actionConfig.message) config.message = actionConfig.message
    } else if (t === 'send_email') {
      if (actionConfig.to.trim()) config.to = actionConfig.to.trim()
      if (actionConfig.recipient === 'record.email') config.recipient = actionConfig.recipient
      if (actionConfig.subject.trim()) config.subject = actionConfig.subject.trim()
      if (actionConfig.message.trim()) config.message = actionConfig.message.trim()
    } else if (t === 'webhook') {
      if (actionConfig.url) { config.url = actionConfig.url; config.method = actionConfig.method }
    }
    try {
      const res = await fetch(`/api/workflows/${selected.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_action', actionType: t, config }),
      })
      if (!res.ok) throw new Error('Add failed')
      toast.success('Action added')
      loadDetail(selected.id)
    } catch { toast.error('Could not add the action') }
  }

  const deleteAction = async (actionId: string) => {
    if (!selected) return
    try {
      const res = await fetch(`/api/workflows/${selected.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_action', actionId }),
      })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Action removed')
      loadDetail(selected.id)
    } catch { toast.error('Could not remove the action') }
  }

  const testRun = async () => {
    if (!selected) return
    try {
      const res = await fetch(`/api/workflows/${selected.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test_run', targetModule: selected.triggerModel ?? 'lead', targetId: 'test' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Test run completed', { description: `Execution: ${data.executionId}` })
      loadDetail(selected.id)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  const runDated = async () => {
    setRunDatedBusy(true)
    try {
      const res = await fetch('/api/workflows/run-dated', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Run failed')
      const results = (data.results ?? []) as { ruleName: string; fired: number; skipped: number; error?: string }[]
      const fired = results.reduce((s, r) => s + r.fired, 0)
      const skipped = results.reduce((s, r) => s + r.skipped, 0)
      const errors = results.filter((r) => r.error).map((r) => `${r.ruleName}: ${r.error}`)
      toast.success(`Date-based runs: ${fired} fired, ${skipped} skipped`, {
        description: errors.length
          ? errors.slice(0, 3).join(' · ')
          : results.length
            ? `Rules: ${results.map((r) => r.ruleName).join(', ')}`
            : 'No active date-based workflows',
      })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not run date-based workflows')
    } finally { setRunDatedBusy(false) }
  }

  // --- Plain-language summary built from current state ---
  const triggerLabel = TRIGGER_TYPES.find((t) => t.value === triggerDraft.triggerType)?.label ?? triggerDraft.triggerType
  const modelLabel = MODELS.find((m) => m.value === triggerDraft.triggerModel)?.label ?? triggerDraft.triggerModel
  const condText = condRows.length === 0
    ? 'any record'
    : condRows.map((r) => {
        if (!r.field || !r.operator) return '(incomplete condition)'
        const f = FIELD_CATALOG.find((x) => x.api === r.field)?.label ?? r.field
        const op = OPERATOR_LABELS[r.operator] ?? r.operator
        const v = NO_VALUE_OPERATORS.includes(r.operator) ? '' : r.value ? ` "${r.value}"` : ' "?"'
        return `${f} ${op}${v}`
      }).join(condLogic === 'AND' ? ' AND ' : ' OR ')
  const actionsText = selected?.actions.length
    ? selected.actions.map((a) => ACTION_TYPES.find((t) => t.value === a.actionType)?.label ?? a.actionType).join(', ')
    : 'no actions yet'
  const summary = `When ${triggerLabel} on ${modelLabel}, if ${condText}, then ${actionsText}.`

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground">Automate everything with triggers + actions</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={runDated} disabled={runDatedBusy}>
            {runDatedBusy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Calendar className="mr-1.5 size-4" />}
            Run due date-based
          </Button>
          <Button onClick={() => setNewOpen(true)}><Plus className="mr-1.5 size-4" /> New workflow</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Workflow list */}
        <div className="space-y-2">
          {!workflows ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />) :
           workflows.length === 0 ? (
            <button
              onClick={() => setNewOpen(true)}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition hover:bg-muted/30"
            >
              <Zap className="size-5 text-muted-foreground" aria-hidden />
              <span className="text-sm font-medium">No workflows yet</span>
              <span className="text-xs text-muted-foreground">Click to create your first automation</span>
            </button>
           ) :
           workflows.map((w) => (
            <div key={w.id} className="flex items-start gap-1.5">
              <button onClick={() => loadDetail(w.id)}
                className={`min-w-0 flex-1 rounded-lg border p-3 text-left transition hover:bg-muted/30 ${selected?.id === w.id ? 'border-primary bg-muted/30' : ''}`}>
                <div className="flex items-center gap-2">
                  <Zap className={`size-4 shrink-0 ${w.isActive ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                  <span className="flex-1 truncate font-medium">{w.name}</span>
                  {w.isActive && <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 text-[10px]">active</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {w.triggerType.replace(/_/g, ' ')} · {w._count?.executions ?? 0} runs
                  {w.errorCount > 0 && <span className="text-destructive"> · {w.errorCount} errors</span>}
                </p>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteConfirm(w)}
                disabled={deletingWorkflow}
                aria-label={`Delete workflow ${w.name}`}
                title="Delete workflow"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          ))}
        </div>

        {/* Builder */}
        {selected ? (
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{selected.name}</CardTitle>
                  <CardDescription className="capitalize">{selected.triggerType.replace(/_/g, ' ')} · {selected.triggerModel}</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={testRun}><Play className="mr-1 size-4" /> Test run</Button>
                  <Button size="sm" variant="outline" onClick={() => duplicate(selected.id)}><Copy className="size-4" /></Button>
                  <Button size="sm" variant={selected.isActive ? 'default' : 'outline'} onClick={() => toggleActive(selected.id, !selected.isActive)}>
                    <Power className="mr-1 size-4" /> {selected.isActive ? 'Active' : 'Inactive'}
                  </Button>
                </div>
              </CardHeader>
            </Card>

            {/* Trigger | Conditions | Actions — drafts live in the parent so switching tabs never resets values */}
            <Card>
              <CardContent className="pt-6">
                <Tabs value={tab} onValueChange={setTab}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="trigger">Trigger</TabsTrigger>
                    <TabsTrigger value="conditions">Conditions</TabsTrigger>
                    <TabsTrigger value="actions">Actions</TabsTrigger>
                  </TabsList>

                  {/* ---------------- Trigger tab ---------------- */}
                  <TabsContent value="trigger" className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>When this happens</Label>
                        <Select value={triggerDraft.triggerType} onValueChange={(v) => setTriggerDraft({ ...triggerDraft, triggerType: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TRIGGER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Record type</Label>
                        <Select value={triggerDraft.triggerModel} onValueChange={(v) => {
                          setTriggerDraft({ ...triggerDraft, triggerModel: v })
                          // Contact-only actions vanish when switching model — reset to a valid one.
                          if (!actionTypesForModel(v).some((a) => a.value === actionConfig.actionType)) {
                            setActionConfig({ ...actionConfig, actionType: 'send_email' })
                          }
                        }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {triggerDraft.triggerType === 'field_change' && (
                      <div className="space-y-1.5">
                        <Label>Watched field</Label>
                        <Select value={triggerDraft.fieldChangeField} onValueChange={(v) => setTriggerDraft({ ...triggerDraft, fieldChangeField: v })}>
                          <SelectTrigger><SelectValue placeholder="Select a field" /></SelectTrigger>
                          <SelectContent>
                            {fieldsForModel(triggerDraft.triggerModel).map((f) => <SelectItem key={f.api} value={f.api}>{f.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {!triggerDraft.fieldChangeField && (
                          <p className="text-xs text-destructive">Watched field is required for this trigger.</p>
                        )}
                        <p className="text-xs text-muted-foreground">The workflow fires when this field changes on save.</p>
                      </div>
                    )}

                    {triggerDraft.triggerType === 'date_based' && (
                      <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                        <p className="text-xs font-medium text-muted-foreground">Date-based schedule — runs on records whose date falls on the target day (use the header button to run due rules).</p>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label>Date field</Label>
                            <Input
                              list="wf-date-fields"
                              placeholder="e.g. csmNextCallDate"
                              value={triggerDraft.dateField}
                              onChange={(e) => setTriggerDraft({ ...triggerDraft, dateField: e.target.value })}
                            />
                            <datalist id="wf-date-fields">
                              <option value="createdAt" />
                              <option value="updatedAt" />
                              <option value="csmNextCallDate" />
                              <option value="csmNextStepDueAt" />
                              <option value="lastReachedOutAt" />
                              <option value="dateApproved" />
                              <option value="birthday" />
                            </datalist>
                            {!triggerDraft.dateField.trim() && (
                              <p className="text-xs text-destructive">Date field is required for a date-based trigger.</p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label>Days offset</Label>
                            <Input
                              type="number"
                              value={triggerDraft.offsetDays}
                              onChange={(e) => setTriggerDraft({ ...triggerDraft, offsetDays: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Direction</Label>
                            <Select value={triggerDraft.direction} onValueChange={(v) => setTriggerDraft({ ...triggerDraft, direction: v as 'before' | 'after' })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="before">Before today</SelectItem>
                                <SelectItem value="after">After today</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  {/* ---------------- Conditions tab ---------------- */}
                  <TabsContent value="conditions" className="mt-4 space-y-4">
                    {condRows.length === 0 && (
                      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                        No conditions — the workflow runs for every matching record. Add conditions to narrow it down.
                      </p>
                    )}

                    <div className="space-y-3">
                      {condRows.map((r, i) => {
                        const def = FIELD_CATALOG.find((f) => f.api === r.field)
                        const opType = def?.type ?? 'text'
                        const error = rowError(r)
                        const selectedAnyOf = r.value.split(',').map((s) => s.trim()).filter(Boolean)
                        const [minVal, maxVal] = r.value.split(',').map((s) => s.trim())
                        return (
                          <div key={r.key} className="rounded-lg border p-2.5">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                              <span className="hidden w-5 shrink-0 pt-2 text-xs text-muted-foreground sm:block">{i + 1}.</span>
                              <Select value={r.field} onValueChange={(v) => onRowFieldChange(r.key, v)}>
                                <SelectTrigger className="w-full sm:w-[38%]"><SelectValue placeholder="Field" /></SelectTrigger>
                                <SelectContent>
                                  {fieldsForModel(triggerDraft.triggerModel).map((f) => <SelectItem key={f.api} value={f.api}>{f.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              <Select value={r.operator} onValueChange={(v) => updateRow(r.key, { operator: v, value: '' })}>
                                <SelectTrigger className="w-full sm:w-[30%]"><SelectValue placeholder="Operator" /></SelectTrigger>
                                <SelectContent>
                                  {(OPERATORS[opType] ?? OPERATORS.text).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              <div className="min-w-0 flex-1">
                                {NO_VALUE_OPERATORS.includes(r.operator) ? (
                                  <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">No value needed</div>
                                ) : r.operator === 'between' ? (
                                  <div className="flex items-center gap-1.5">
                                    <Input
                                      type="number" placeholder="Min" className="h-9" value={minVal ?? ''}
                                      onChange={(e) => updateRow(r.key, { value: `${e.target.value},${maxVal ?? ''}` })}
                                    />
                                    <span className="text-xs text-muted-foreground">–</span>
                                    <Input
                                      type="number" placeholder="Max" className="h-9" value={maxVal ?? ''}
                                      onChange={(e) => updateRow(r.key, { value: `${minVal ?? ''},${e.target.value}` })}
                                    />
                                  </div>
                                ) : r.operator === 'is_before_days_ago' ? (
                                  <div className="flex items-center gap-1.5">
                                    <Input
                                      type="number" placeholder="X" className="h-9 w-24" min={0}
                                      value={r.value}
                                      onChange={(e) => updateRow(r.key, { value: e.target.value })}
                                    />
                                    <span className="text-xs text-muted-foreground">days ago</span>
                                  </div>
                                ) : def?.type === 'picklist' && r.operator === 'is_any_of' ? (
                                  <div className="flex flex-wrap gap-1.5">
                                    {(def.options ?? []).map((opt) => (
                                      <button
                                        key={opt} type="button" onClick={() => onAnyOfToggle(r, opt)}
                                        className={`rounded-full border px-2.5 py-1 text-xs transition ${selectedAnyOf.includes(opt) ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/40'}`}
                                      >
                                        {opt}
                                      </button>
                                    ))}
                                  </div>
                                ) : def?.type === 'picklist' ? (
                                  <Select value={r.value} onValueChange={(v) => updateRow(r.key, { value: v })}>
                                    <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Value" /></SelectTrigger>
                                    <SelectContent>
                                      {(def.options ?? []).map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Input
                                    type={def?.type === 'date' ? 'date' : def?.type === 'number' || def?.type === 'percent' ? 'number' : 'text'}
                                    placeholder={def?.type === 'date' ? 'Pick a date' : def?.type === 'percent' ? '0–100' : 'Value'}
                                    className="h-9"
                                    value={r.value}
                                    onChange={(e) => updateRow(r.key, { value: e.target.value })}
                                  />
                                )}
                              </div>
                              <Button variant="ghost" size="icon" className="size-9 shrink-0 text-destructive" onClick={() => removeRow(r.key)} aria-label="Remove condition">
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                            {error && <p className="mt-1.5 pl-0 text-xs text-destructive sm:pl-7">{error}</p>}
                          </div>
                        )
                      })}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button variant="outline" size="sm" onClick={addRow}><Plus className="mr-1 size-3.5" /> Add condition</Button>
                      <div className="flex items-center gap-1 rounded-lg border p-0.5">
                        {(['AND', 'OR'] as const).map((l) => (
                          <button
                            key={l} type="button" onClick={() => setCondLogic(l)}
                            className={`rounded-md px-3 py-1 text-xs font-medium transition ${condLogic === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/40'}`}
                            aria-pressed={condLogic === l}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                      {condRows.length > 1 && (
                        <span className="text-xs text-muted-foreground">Match {condLogic === 'AND' ? 'all' : 'any'} of the conditions</span>
                      )}
                    </div>
                  </TabsContent>

                  {/* ---------------- Actions tab ---------------- */}
                  <TabsContent value="actions" className="mt-4 space-y-2">
                    {/* Trigger node */}
                    <div className="flex items-center gap-3 rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
                      <div className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground"><Zap className="size-4" /></div>
                      <div className="flex-1">
                        <p className="text-sm font-medium capitalize">{triggerLabel}</p>
                        <p className="text-xs text-muted-foreground">Trigger · {modelLabel}</p>
                      </div>
                    </div>

                    {selected.actions.length > 0 && <div className="flex justify-center"><ArrowRight className="size-4 rotate-90 text-muted-foreground" /></div>}

                    {selected.actions.map((a, i) => {
                      const actionDef = ACTION_TYPES.find((t) => t.value === a.actionType)
                      const Icon = actionDef?.icon ?? Zap
                      const config = safeJsonParse<any>(a.config, {})
                      return (
                        <React.Fragment key={a.id}>
                          <div className="flex items-center gap-3 rounded-lg border p-3">
                            <div className="flex size-9 items-center justify-center rounded-full bg-muted"><Icon className="size-4 text-muted-foreground" /></div>
                            <div className="flex-1">
                              <p className="text-sm font-medium">{actionDef?.label ?? a.actionType}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {config.title || config.message || config.field || config.tag || config.value || config.url || 'Action'}
                              </p>
                            </div>
                            <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => deleteAction(a.id)}><Trash2 className="size-3.5" /></Button>
                          </div>
                          {i < selected.actions.length - 1 && <div className="flex justify-center"><ArrowRight className="size-4 rotate-90 text-muted-foreground" /></div>}
                        </React.Fragment>
                      )
                    })}

                    {/* Add action */}
                    <div className="mt-3 rounded-lg border border-dashed p-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">Add action</p>
                      <div className="space-y-2">
                        <Select value={actionConfig.actionType} onValueChange={(v) => setActionConfig({ ...actionConfig, actionType: v })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {actionTypesForModel(triggerDraft.triggerModel).map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                          </SelectContent>
                        </Select>

                        {actionConfig.actionType === 'create_task' && (
                          <Input placeholder="Task title" value={actionConfig.title} onChange={(e) => setActionConfig({ ...actionConfig, title: e.target.value })} className="h-8" />
                        )}
                        {(actionConfig.actionType === 'create_task' || actionConfig.actionType === 'create_task_owner') && (
                          <div className="flex items-center gap-2">
                            <Label className="shrink-0 text-xs text-muted-foreground">Due in</Label>
                            <Input type="number" min={0} value={actionConfig.dueInDays} onChange={(e) => setActionConfig({ ...actionConfig, dueInDays: e.target.value })} className="h-8 w-24" />
                            <span className="text-xs text-muted-foreground">days</span>
                          </div>
                        )}
                        {actionConfig.actionType === 'create_task_owner' && (
                          <Input placeholder="Task title" value={actionConfig.title} onChange={(e) => setActionConfig({ ...actionConfig, title: e.target.value })} className="h-8" />
                        )}
                        {(actionConfig.actionType === 'alert' || actionConfig.actionType === 'notify_team' || actionConfig.actionType === 'notify_inapp_owner') && (
                          <Input placeholder="Message" value={actionConfig.message} onChange={(e) => setActionConfig({ ...actionConfig, message: e.target.value })} className="h-8" />
                        )}
                        {actionConfig.actionType === 'update_field' && (
                          <div className="grid grid-cols-2 gap-2">
                            <Input placeholder="field" value={actionConfig.field} onChange={(e) => setActionConfig({ ...actionConfig, field: e.target.value })} className="h-8" />
                            <Input placeholder="value" value={actionConfig.value} onChange={(e) => setActionConfig({ ...actionConfig, value: e.target.value })} className="h-8" />
                          </div>
                        )}
                        {(actionConfig.actionType === 'add_tag' || actionConfig.actionType === 'remove_tag') && (
                          <Input placeholder="tag name" value={actionConfig.tag} onChange={(e) => setActionConfig({ ...actionConfig, tag: e.target.value })} className="h-8" />
                        )}
                        {actionConfig.actionType === 'update_csm_next_step' && (
                          <Select value={actionConfig.csmStep} onValueChange={(v) => setActionConfig({ ...actionConfig, csmStep: v })}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CSM_VALUES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                        {actionConfig.actionType === 'update_csm_status' && (
                          <Input placeholder="CSM status (e.g. Engaged)" value={actionConfig.csmStatus} onChange={(e) => setActionConfig({ ...actionConfig, csmStatus: e.target.value })} className="h-8" />
                        )}
                        {(actionConfig.actionType === 'send_email_owner' || actionConfig.actionType === 'send_email_contact') && (
                          <>
                            <Input placeholder="Subject" value={actionConfig.subject} onChange={(e) => setActionConfig({ ...actionConfig, subject: e.target.value })} className="h-8" />
                            <Input placeholder="Message" value={actionConfig.message} onChange={(e) => setActionConfig({ ...actionConfig, message: e.target.value })} className="h-8" />
                          </>
                        )}
                        {actionConfig.actionType === 'webhook' && (
                          <div className="grid grid-cols-[1fr_110px] gap-2">
                            <Input placeholder="https://example.com/hook" value={actionConfig.url} onChange={(e) => setActionConfig({ ...actionConfig, url: e.target.value })} className="h-8" />
                            <Select value={actionConfig.method} onValueChange={(v) => setActionConfig({ ...actionConfig, method: v })}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {(actionConfig.actionType === 'set_last_reached_out' || actionConfig.actionType === 'increment_reachouts') && (
                          <p className="text-xs text-muted-foreground">
                            {actionConfig.actionType === 'set_last_reached_out' ? 'Stamps Last Reached-Out Time on the contact to now.' : 'Adds +1 to Total Reachouts Done on the contact.'}
                            {' '}No configuration needed.
                          </p>
                        )}
                        {actionConfig.actionType === 'send_email' && (
                          <>
                            <div className="flex items-center gap-2">
                              <Input
                                placeholder="Leave empty to email the record's address"
                                value={actionConfig.to}
                                onChange={(e) => setActionConfig({ ...actionConfig, to: e.target.value })}
                                className="h-8"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant={actionConfig.recipient === 'record.email' ? 'secondary' : 'outline'}
                                className="h-8 shrink-0"
                                aria-pressed={actionConfig.recipient === 'record.email'}
                                onClick={() => setActionConfig({ ...actionConfig, recipient: actionConfig.recipient === 'record.email' ? '' : 'record.email' })}
                              >
                                Use record's email
                              </Button>
                            </div>
                            <Input placeholder="Subject" value={actionConfig.subject} onChange={(e) => setActionConfig({ ...actionConfig, subject: e.target.value })} className="h-8" />
                            <Textarea
                              placeholder="Message"
                              rows={3}
                              value={actionConfig.message}
                              onChange={(e) => setActionConfig({ ...actionConfig, message: e.target.value })}
                              className="min-h-[72px] text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                              {'Falls back to the record\'s primary email when "Use record\'s email" is on or To is empty.'}
                            </p>
                          </>
                        )}
                        {(actionConfig.actionType === 'delay' || actionConfig.actionType === 'if_else') && (
                          <p className="text-xs text-muted-foreground">This action type has no configurable options yet.</p>
                        )}
                        <Button size="sm" onClick={addAction}><Plus className="mr-1 size-3.5" /> Add</Button>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Summary + save */}
            <Card>
              <CardContent className="space-y-3 pt-6">
                <p className="text-sm leading-relaxed">
                  <span className="font-medium">Summary: </span>
                  <span className="text-muted-foreground">{summary}</span>
                </p>
                {saveInvalid && (
                  <p className="text-xs text-destructive">
                    Fix the highlighted {triggerDraft.triggerType === 'date_based' ? 'date field' : 'condition rows'} before saving.
                  </p>
                )}
                <div className="flex justify-end">
                  <Button onClick={() => setSaveOpen(true)} disabled={saveInvalid}>Save changes</Button>
                </div>
              </CardContent>
            </Card>

            {/* Recent runs */}
            {selected.executions && selected.executions.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-1.5 text-sm"><History className="size-4" /> Recent runs</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                    {selected.executions.map((ex) => (
                      <div key={ex.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
                        {ex.status === 'completed'
                          ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                          : <XCircle className="size-3.5 shrink-0 text-destructive" />}
                        <span className="capitalize">{ex.status}</span>
                        <span className="truncate text-muted-foreground">{ex.targetModule} · {new Date(ex.createdAt).toLocaleString()}</span>
                        {ex.errorMessage && <span className="ml-auto truncate text-destructive">{ex.errorMessage}</span>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">Select a workflow to edit</CardContent></Card>
        )}
      </div>

      {/* Save confirmation with plain-language summary */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Apply this workflow?</DialogTitle>
            <DialogDescription>Review the automation before saving.</DialogDescription>
          </DialogHeader>
          <p className="rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed">{summary}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button onClick={saveChanges} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />} Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New workflow dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription className="sr-only">Name the workflow and pick its trigger.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={newWf.name} onChange={(e) => setNewWf({ ...newWf, name: e.target.value })} placeholder="Welcome New Lead" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Trigger</Label><Select value={newWf.triggerType} onValueChange={(v) => setNewWf({ ...newWf, triggerType: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TRIGGER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Model</Label><Select value={newWf.triggerModel} onValueChange={(v) => setNewWf({ ...newWf, triggerModel: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={!newWf.name.trim() || !newWf.triggerType}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete workflow confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o) setDeleteConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteConfirm?.name ? `"${deleteConfirm.name}"` : 'this workflow'}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void deleteWorkflow() }}
              disabled={deletingWorkflow}
            >
              {deletingWorkflow ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Trash2 className="mr-1 size-4" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
