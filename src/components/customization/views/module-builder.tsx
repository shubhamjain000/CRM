'use client'

/**
 * Module Builder — enhanced Modules tab for Platform Settings.
 *
 * Covers:
 *  5.1  22 field types (grouped dropdown), legacy `text`/`long_text`/`rating` kept working
 *  5.2  Field settings dialog: mandatory / unique / read-only / default / help text /
 *       dependency + type-specific options (picklist options, formula, autonumber
 *       prefix, lookup target, file/image accept hint)
 *  5.3  Sections & layout manager (add / rename / remove / columns / collapsible),
 *       drag-and-drop fields between sections with ▲▼ keyboard-accessible fallback
 *  5.4  Module-level settings: active toggle, icon, display + plural name,
 *       record name format ("field" | "auto:PREFIX"), custom views CRUD
 *  5.5  Related lists: relation CRUD + per-record related lists with link / unlink
 *
 * Wire format is documented in src/app/api/custom-modules/[id]/route.ts.
 */

import * as React from 'react'
import {
  Plus, Trash2, Settings2, GripVertical, ChevronUp, ChevronDown, Link2, Unlink,
  ChevronRight, Check, Box, Briefcase, Building2, Package, Users, ShoppingCart, Wrench,
  FileText, Globe, Star, Tag, CalendarDays, Zap, Loader2, Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { safeJsonParse } from '@/components/safe-json'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>

interface FieldT {
  id: string
  label: string
  apiName: string
  fieldType: string
  fieldOptions: string
  defaultValue: string | null
  isRequired: boolean
  isUnique: boolean
  isSearchable: boolean
  displayOrder: number
  section: string | null
  helpText: string | null
  isReadOnly: boolean
  dependency: string | null
}

interface ModuleT {
  id: string
  name: string
  pluralName: string
  slug: string
  icon: string
  color: string
  recordNameField: string
  isActive: boolean
  isSystem: boolean
  sectionsConfig: string
  viewsConfig: string
  recordNameFormat: string | null
  _count?: { fields: number; records: number }
}

interface SectionT { name: string; columns: 1 | 2; collapsible: boolean }
interface ViewT { name: string; filters: Record<string, string> }
type RelationType = 'one_to_many' | 'many_to_many'

interface RelationT {
  id: string
  name: string
  parentModuleId: string
  childModuleId: string
  childFieldApiName: string
  type: RelationType
}

interface RecordT {
  id: string
  moduleId: string
  data: string
  createdAt: string
  updatedAt: string
  createdById?: string | null // additive: auto-tracked by the API on create
  modifiedById?: string | null // additive: auto-tracked by the API on update
}

interface DetailT {
  module: ModuleT
  fields: FieldT[]
  sections: SectionT[]
  views: ViewT[]
  relations: RelationT[]
  records: RecordT[]
}

// ---------------------------------------------------------------------------
// Field type registry (5.1)
// ---------------------------------------------------------------------------

const FIELD_TYPE_GROUPS: { group: string; types: string[] }[] = [
  { group: 'Text', types: ['single_line', 'multi_line', 'email', 'phone', 'url'] },
  { group: 'Numbers', types: ['number', 'currency', 'percent', 'decimal'] },
  { group: 'Date & Time', types: ['date', 'datetime', 'time'] },
  { group: 'Selection', types: ['picklist', 'multiselect', 'checkbox', 'radio'] },
  { group: 'Advanced', types: ['lookup', 'owner', 'formula', 'file', 'image', 'autonumber'] },
]

const FIELD_TYPE_LABELS: Record<string, string> = {
  single_line: 'Single Line', multi_line: 'Multi-Line', email: 'Email', phone: 'Phone', url: 'URL',
  number: 'Number', currency: 'Currency', percent: 'Percent', decimal: 'Decimal',
  date: 'Date', datetime: 'Date & Time', time: 'Time',
  picklist: 'Picklist', multiselect: 'Multi-Select', checkbox: 'Checkbox', radio: 'Radio',
  lookup: 'Lookup', owner: 'Owner', formula: 'Formula', file: 'File', image: 'Image', autonumber: 'Auto Number',
  // legacy aliases (kept for migration tolerance)
  text: 'Text (legacy)', long_text: 'Long Text (legacy)', rating: 'Rating (legacy)',
}

const LEGACY_TYPE_MAP: Record<string, string> = { text: 'single_line', long_text: 'multi_line' }
const canonicalType = (t: string) => LEGACY_TYPE_MAP[t] ?? t
const typeLabel = (t: string) => FIELD_TYPE_LABELS[t] ?? t

// ---------------------------------------------------------------------------
// Icon registry (5.4)
// ---------------------------------------------------------------------------

const ICON_PRESETS = ['Box', 'Briefcase', 'Building2', 'Package', 'Users', 'ShoppingCart', 'Wrench', 'FileText', 'Globe', 'Star', 'Tag', 'CalendarDays']
const ICONS: Record<string, LucideIcon> = { Box, Briefcase, Building2, Package, Users, ShoppingCart, Wrench, FileText, Globe, Star, Tag, CalendarDays, Zap }

function ModIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Box
  return <Icon className={className} />
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function parseOptions(raw: string | null | undefined): AnyRecord {
  return safeJsonParse<AnyRecord>(raw ?? '{}', {})
}

function optionsList(f: FieldT): string[] {
  const o = parseOptions(f.fieldOptions)
  return Array.isArray(o.options) ? o.options.map((v) => String(v)) : []
}

function depOf(f: FieldT): { field: string; value: string } | null {
  if (!f.dependency) return null
  const d = safeJsonParse<AnyRecord>(f.dependency, {})
  if (!d.field) return null
  return { field: String(d.field), value: String(d.value ?? '') }
}

/** A field is visible in the record form when its dependency rule matches. */
function fieldVisible(f: FieldT, data: AnyRecord): boolean {
  const dep = depOf(f)
  if (!dep) return true
  const cur = data[dep.field]
  return String(cur ?? '') === String(dep.value ?? '')
}

/**
 * sectionsConfig tolerant reader — `{}` / missing sections synthesizes the
 * default 'General' section (or one section per existing field.section value).
 */
function parseSections(raw: string | null | undefined, fields: FieldT[]): SectionT[] {
  const cfg = safeJsonParse<{ sections?: unknown }>(raw ?? '{}', {})
  if (Array.isArray(cfg.sections) && cfg.sections.length > 0) {
    const seen = new Set<string>()
    const out: SectionT[] = []
    for (const s of cfg.sections) {
      if (!s || typeof s !== 'object') continue
      const name = String((s as AnyRecord).name ?? '').trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push({ name, columns: Number((s as AnyRecord).columns) === 1 ? 1 : 2, collapsible: Boolean((s as AnyRecord).collapsible) })
    }
    if (out.length > 0) return out
  }
  const names: string[] = []
  for (const f of [...fields].sort((a, b) => a.displayOrder - b.displayOrder)) {
    const n = (f.section ?? '').trim() || 'General'
    if (!names.includes(n)) names.push(n)
  }
  if (names.length === 0) names.push('General')
  return names.map((n) => ({ name: n, columns: 2 as const, collapsible: false }))
}

/** viewsConfig tolerant reader — `[]` / missing views yields just 'All records'. */
function parseViews(raw: string | null | undefined): ViewT[] {
  const arr = safeJsonParse<unknown[]>(raw ?? '[]', [])
  if (!Array.isArray(arr)) return []
  const out: ViewT[] = []
  for (const v of arr) {
    if (!v || typeof v !== 'object') continue
    const name = String((v as AnyRecord).name ?? '').trim()
    if (!name) continue
    const filters: Record<string, string> = {}
    const rf = (v as AnyRecord).filters
    if (rf && typeof rf === 'object') for (const [k, val] of Object.entries(rf as AnyRecord)) filters[k] = String(val ?? '')
    out.push({ name, filters })
  }
  return out
}

/** Record display name: 'auto:PREFIX' format → generated data.name; else data[recordNameField]. */
function recordName(rec: RecordT, mod: Pick<ModuleT, 'recordNameField' | 'recordNameFormat'>): string {
  const data = safeJsonParse<AnyRecord>(rec.data, {})
  const fmt = mod.recordNameFormat ?? ''
  if (fmt.startsWith('auto:')) return String(data.name ?? '') || 'Untitled'
  const key = mod.recordNameField || 'name'
  const v = data[key]
  if (v !== undefined && v !== null && String(v) !== '') return String(v)
  return String(data.name ?? '') || 'Untitled'
}

function viewMatches(rec: RecordT, filters: Record<string, string>): boolean {
  const data = safeJsonParse<AnyRecord>(rec.data, {})
  return Object.entries(filters).every(([k, v]) => {
    const cur = data[k]
    if (Array.isArray(cur)) return cur.map(String).includes(v)
    return String(cur ?? '') === String(v ?? '')
  })
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/**
 * Formula evaluation — tiny recursive-descent parser over numbers, field
 * apiNames and + - * / ( ). No eval. Returns null when the expression is
 * invalid (UI shows '—').
 */
function evaluateFormula(expr: string, data: AnyRecord): number | null {
  const cleaned = expr.replace(/\s+/g, '')
  if (!cleaned) return null
  const tokens = cleaned.match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[+\-*/()]/g)
  if (!tokens || tokens.join('') !== cleaned) return null
  let pos = 0
  const peek = () => tokens[pos]
  const read = (): string | undefined => tokens[pos++]
  const factor = (): number => {
    const t = read()
    if (t === undefined) throw new Error('unexpected end')
    if (t === '(') { const v = expr7(); if (read() !== ')') throw new Error('missing )'); return v }
    if (t === '-') return -factor()
    if (t === '+') return factor()
    if (/^\d/.test(t)) return parseFloat(t)
    const raw = data[t]
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
    return Number.isFinite(n) ? n : 0
  }
  const term = (): number => {
    let v = factor()
    while (peek() === '*' || peek() === '/') { const op = read(); const r = factor(); v = op === '*' ? v * r : v / r }
    return v
  }
  const expr7 = (): number => {
    let v = term()
    while (peek() === '+' || peek() === '-') { const op = read(); const r = term(); v = op === '+' ? v + r : v - r }
    return v
  }
  try {
    const result = expr7()
    if (pos !== tokens.length || !Number.isFinite(result)) return null
    return result
  } catch {
    return null
  }
}

function fmtFormula(n: number | null): string {
  if (n === null) return '—'
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

async function apiPost<T = AnyRecord>(url: string, body: unknown): Promise<{ ok: boolean; data: T & { error?: string; field?: string } }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

// ---------------------------------------------------------------------------
// ModulesTab (drop-in replacement for the old one)
// ---------------------------------------------------------------------------

export function ModulesTab() {
  const [modules, setModules] = React.useState<ModuleT[] | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<DetailT | null>(null)
  const [newMod, setNewMod] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  const load = React.useCallback(async () => {
    const res = await fetch('/api/custom-modules', { cache: 'no-store' })
    const data = await res.json()
    setModules(data.modules ?? [])
  }, [])
  React.useEffect(() => { load() }, [load])

  const loadDetail = React.useCallback(async (id: string) => {
    setSelectedId(id)
    setDetail(null)
    const res = await fetch(`/api/custom-modules/${id}?records=true`, { cache: 'no-store' })
    const j = await res.json()
    setDetail({
      module: j.module,
      fields: j.fields ?? [],
      sections: j.sections ?? [],
      views: j.views ?? [],
      relations: j.relations ?? [],
      records: j.records ?? [],
    })
  }, [])

  const refresh = React.useCallback(async (id?: string | null) => {
    await load()
    const target = id ?? selectedId
    if (target) await loadDetail(target)
  }, [load, loadDetail, selectedId])

  const createModule = async () => {
    const name = newMod.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const { ok, data } = await apiPost<{ id: string }>('/api/custom-modules', { name })
      if (!ok) { toast.error(data.error || 'Could not create module'); return }
      toast.success('Module created')
      setNewMod('')
      await load()
      await loadDetail(data.id)
    } finally { setCreating(false) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="New module name"
            value={newMod}
            onChange={(e) => setNewMod(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createModule() }}
            className="h-8"
          />
          <Button size="sm" onClick={createModule} disabled={creating} aria-label="Create module">
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          </Button>
        </div>
        {!modules ? <Skeleton className="h-32 w-full" /> : modules.map((m) => (
          <button
            key={m.id}
            onClick={() => loadDetail(m.id)}
            className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/30 ${selectedId === m.id ? 'border-primary bg-muted/30' : ''}`}
          >
            <div className="flex items-center gap-2">
              <ModIcon name={m.icon} className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate font-medium">{m.name}</span>
              {!m.isActive && <Badge variant="secondary" className="text-[10px]">Disabled</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{m._count?.fields ?? 0} fields · {m._count?.records ?? 0} records</p>
          </button>
        ))}
        {modules && modules.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No modules yet — create one above</p>}
      </div>
      {selectedId ? (
        detail ? (
          <ModuleDetail detail={detail} allModules={modules ?? []} onRefresh={refresh} />
        ) : (
          <div className="space-y-4">{<Skeleton className="h-24 w-full" />}{<Skeleton className="h-64 w-full" />}</div>
        )
      ) : (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Select a module to open the builder</CardContent></Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Module detail — settings / fields / views / relations / records cards
// ---------------------------------------------------------------------------

function ModuleDetail({ detail, allModules, onRefresh }: { detail: DetailT; allModules: ModuleT[]; onRefresh: (id?: string | null) => Promise<void> }) {
  const { module: mod } = detail
  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <span className="flex size-9 items-center justify-center rounded-lg border" style={{ backgroundColor: `${mod.color}1a` }}>
            <ModIcon name={mod.icon} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span className="truncate">{mod.name}</span>
              {!mod.isActive && <Badge variant="secondary" className="text-[10px]">Disabled</Badge>}
              {mod.isSystem && <Badge variant="outline" className="text-[10px]">system</Badge>}
            </CardTitle>
            <CardDescription className="truncate">{mod.pluralName} · <span className="font-mono">{mod.slug}</span></CardDescription>
          </div>
        </CardHeader>
      </Card>
      <ModuleSettingsCard mod={mod} fields={detail.fields} onSaved={() => onRefresh(mod.id)} />
      <FieldsLayoutCard detail={detail} allModules={allModules} onRefresh={() => onRefresh(mod.id)} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ViewsCard mod={mod} fields={detail.fields} views={detail.views} onSaved={() => onRefresh(mod.id)} />
        <RelationsCard mod={mod} relations={detail.relations} allModules={allModules} onSaved={() => onRefresh(mod.id)} />
      </div>
      <RecordsCard detail={detail} onSaved={() => onRefresh(mod.id)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 5.4 — Module settings card
// ---------------------------------------------------------------------------

function ModuleSettingsCard({ mod, fields, onSaved }: { mod: ModuleT; fields: FieldT[]; onSaved: () => void }) {
  const [name, setName] = React.useState(mod.name)
  const [pluralName, setPluralName] = React.useState(mod.pluralName)
  const [icon, setIcon] = React.useState(mod.icon)
  const [fmt, setFmt] = React.useState<'field' | 'auto'>((mod.recordNameFormat ?? '').startsWith('auto:') ? 'auto' : 'field')
  const [recordNameField, setRecordNameField] = React.useState(mod.recordNameField || 'name')
  const [autoPrefix, setAutoPrefix] = React.useState(() => {
    const f = mod.recordNameFormat ?? ''
    return f.startsWith('auto:') ? f.slice(5) : mod.slug
  })
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => {
    setName(mod.name); setPluralName(mod.pluralName); setIcon(mod.icon)
    const f = mod.recordNameFormat ?? ''
    setFmt(f.startsWith('auto:') ? 'auto' : 'field')
    setRecordNameField(mod.recordNameField || 'name')
    setAutoPrefix(f.startsWith('auto:') ? f.slice(5) : mod.slug)
  }, [mod])

  const toggleActive = async (isActive: boolean) => {
    const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, { action: 'update_settings', isActive })
    if (!ok) { toast.error(data.error || 'Update failed'); return }
    toast.success(isActive ? 'Module enabled' : 'Module disabled')
    onSaved()
  }

  const save = async () => {
    if (!name.trim()) { toast.error('Module name is required'); return }
    setSaving(true)
    try {
      const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, {
        action: 'update_settings',
        name: name.trim(),
        pluralName: pluralName.trim() || name.trim() + 's',
        icon,
        recordNameField: fmt === 'field' ? recordNameField : undefined,
        recordNameFormat: fmt === 'auto' ? `auto:${autoPrefix.trim() || mod.slug}` : null,
      })
      if (!ok) { toast.error(data.error || 'Update failed'); return }
      toast.success('Module settings saved')
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm">Module Settings</CardTitle>
          <CardDescription>Identity, record naming and availability</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="mod-active" className="text-xs text-muted-foreground">{mod.isActive ? 'Enabled' : 'Disabled'}</Label>
          <Switch id="mod-active" checked={mod.isActive} onCheckedChange={toggleActive} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mod-name" className="text-xs">Display name</Label>
            <Input id="mod-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mod-plural" className="text-xs">Plural label</Label>
            <Input id="mod-plural" value={pluralName} onChange={(e) => setPluralName(e.target.value)} className="h-8" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Icon</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            <Input value={icon} onChange={(e) => setIcon(e.target.value)} className="h-8 w-36 font-mono text-xs" aria-label="Lucide icon name" />
            {ICON_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                title={n}
                aria-label={`Use icon ${n}`}
                onClick={() => setIcon(n)}
                className={`flex size-8 items-center justify-center rounded border transition hover:bg-muted/40 ${icon === n ? 'border-primary bg-muted/40' : ''}`}
              >
                <ModIcon name={n} className="size-4" />
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Record name format</Label>
          <RadioGroup value={fmt} onValueChange={(v) => setFmt(v as 'field' | 'auto')} className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="field" id="fmt-field" />
              <Label htmlFor="fmt-field" className="font-normal">Based on a field</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="auto" id="fmt-auto" />
              <Label htmlFor="fmt-auto" className="font-normal">Auto number (PREFIX-0001)</Label>
            </div>
          </RadioGroup>
          {fmt === 'field' ? (
            <Select value={recordNameField} onValueChange={setRecordNameField}>
              <SelectTrigger className="h-8 sm:w-64"><SelectValue placeholder="Name field" /></SelectTrigger>
              <SelectContent>
                {fields.map((f) => <SelectItem key={f.id} value={f.apiName}>{f.label} <span className="ml-1 font-mono text-[10px] text-muted-foreground">{f.apiName}</span></SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input value={autoPrefix} onChange={(e) => setAutoPrefix(e.target.value)} placeholder="PREFIX" className="h-8 w-36 font-mono" aria-label="Auto name prefix" />
              <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">Records will be named <span className="font-mono">{autoPrefix.trim() || mod.slug}-0001</span>, auto-incremented</span>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 5.1 + 5.2 + 5.3 — Fields & layout card
// ---------------------------------------------------------------------------

function FieldsLayoutCard({ detail, allModules, onRefresh }: { detail: DetailT; allModules: ModuleT[]; onRefresh: () => Promise<void> | void }) {
  const { module: mod, fields, sections } = detail
  const [newLabel, setNewLabel] = React.useState('')
  const [newType, setNewType] = React.useState('single_line')
  const [adding, setAdding] = React.useState(false)
  const [editFieldId, setEditFieldId] = React.useState<string | null>(null)
  const [deleteField, setDeleteField] = React.useState<FieldT | null>(null)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropHint, setDropHint] = React.useState<string | null>(null)
  const [sectionEdits, setSectionEdits] = React.useState<Record<string, string>>({})

  const ordered = React.useMemo(() => [...fields].sort((a, b) => a.displayOrder - b.displayOrder), [fields])
  const editField = fields.find((f) => f.id === editFieldId) ?? null

  const addField = async () => {
    const label = newLabel.trim()
    if (!label || adding) return
    setAdding(true)
    try {
      const apiName = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `field_${Date.now()}`
      const { ok, data } = await apiPost<{ id?: string }>(`/api/custom-modules/${mod.id}`, {
        action: 'add_field',
        label,
        apiName,
        fieldType: newType,
        section: sections[0]?.name ?? 'General',
      })
      if (!ok) { toast.error(data.error || 'Could not add field'); return }
      toast.success('Field added')
      setNewLabel('')
      await onRefresh()
      if (data.id) setEditFieldId(data.id) // open the settings dialog right away
    } finally { setAdding(false) }
  }

  /** Persist a new global order. `sectionOf` overrides a field's section (DnD move). */
  const persistOrder = async (orderedIds: string[], sectionOf: Record<string, string>) => {
    const payload = orderedIds.map((fid, i) => ({ id: fid, section: sectionOf[fid] ?? fields.find((f) => f.id === fid)?.section ?? sections[0]?.name ?? 'General', displayOrder: i }))
    const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, { action: 'reorder_fields', fields: payload })
    if (!ok) { toast.error(data.error || 'Reorder failed'); return }
    await onRefresh()
  }

  /** Drop `dragId` into `toSection`, optionally before `beforeId`. */
  const moveField = async (dragId: string, toSection: string, beforeId: string | null) => {
    const ids = ordered.map((f) => f.id)
    const from = ids.indexOf(dragId)
    if (from === -1) return
    ids.splice(from, 1)
    let insertAt = beforeId ? ids.indexOf(beforeId) : ids.length
    if (insertAt === -1) insertAt = ids.length
    ids.splice(insertAt, 0, dragId)
    await persistOrder(ids, { [dragId]: toSection })
  }

  /** ▲▼ fallback — swaps with the previous/next field of the SAME section. */
  const nudge = async (fieldId: string, dir: -1 | 1) => {
    const f = ordered.find((x) => x.id === fieldId)
    if (!f) return
    const own = ordered.filter((x) => (x.section ?? sections[0]?.name ?? 'General') === (f.section ?? sections[0]?.name ?? 'General'))
    const idx = own.findIndex((x) => x.id === fieldId)
    const other = own[idx + dir]
    if (!other) return
    const ids = ordered.map((x) => x.id)
    const a = ids.indexOf(fieldId)
    const b = ids.indexOf(other.id)
    ids[a] = other.id; ids[b] = fieldId
    await persistOrder(ids, {})
  }

  const saveSections = async (next: SectionT[]) => {
    const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, { action: 'update_sections', sections: next })
    if (!ok) { toast.error(data.error || 'Could not save sections'); return }
    await onRefresh()
  }

  const addSection = () => {
    let n = sections.length + 1
    let name = `Section ${n}`
    while (sections.some((s) => s.name === name)) { n += 1; name = `Section ${n}` }
    saveSections([...sections, { name, columns: 2, collapsible: false }])
  }

  /** Removing a section re-parents its fields to the first remaining section (never deletes fields). */
  const removeSection = async (name: string) => {
    const next = sections.filter((s) => s.name !== name)
    if (next.length === 0) { toast.error('A module needs at least one section'); return }
    const fallback = next[0].name
    const ids = ordered.map((f) => f.id)
    const sectionOf: Record<string, string> = {}
    for (const f of ordered) if ((f.section ?? fallback) === name || f.section === name) sectionOf[f.id] = fallback
    const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, { action: 'update_sections', sections: next })
    if (!ok) { toast.error(data.error || 'Could not remove section'); return }
    if (Object.keys(sectionOf).length > 0) await persistOrder(ids, sectionOf)
    else await onRefresh()
  }

  const patchSection = async (name: string, patch: Partial<SectionT>) => {
    saveSections(sections.map((s) => (s.name === name ? { ...s, ...patch } : s)))
  }

  const renameSection = async (oldName: string) => {
    const next = (sectionEdits[oldName] ?? '').trim()
    setSectionEdits((s) => { const c = { ...s }; delete c[oldName]; return c })
    if (!next || next === oldName) return
    if (sections.some((s) => s.name === next)) { toast.error('A section with that name already exists'); return }
    // rename section + migrate fields' section keys in one round-trip each
    const ids = ordered.map((f) => f.id)
    const sectionOf: Record<string, string> = {}
    for (const f of ordered) if ((f.section ?? sections[0]?.name ?? 'General') === oldName) sectionOf[f.id] = next
    const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, { action: 'update_sections', sections: sections.map((s) => (s.name === oldName ? { ...s, name: next } : s)) })
    if (!ok) { toast.error(data.error || 'Rename failed'); return }
    if (Object.keys(sectionOf).length > 0) await persistOrder(ids, sectionOf)
    else await onRefresh()
  }

  const doDeleteField = async () => {
    if (!deleteField) return
    const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, { action: 'delete_field', fieldId: deleteField.id })
    if (!ok) { toast.error(data.error || 'Delete failed'); return }
    toast.success('Field deleted')
    setDeleteField(null)
    await onRefresh()
  }

  // group ordered fields per section (leftover sections fall into the first one)
  const groups = sections.map((s) => ({ section: s, items: ordered.filter((f) => (f.section ?? sections[0]?.name ?? 'General') === s.name) }))
  const known = new Set(sections.map((s) => s.name))
  // Only fields whose section is SET but unknown are leftovers — null-section
  // fields already sit in the fallback (first) section via the coalesce above;
  // double-bucketing them produced duplicate React keys.
  const leftovers = ordered.filter((f) => f.section && !known.has(f.section))
  if (leftovers.length > 0 && groups.length > 0) groups[0].items.push(...leftovers)

  // Lookup fields show which module they point at (name resolved from allModules).
  const moduleById = React.useMemo(() => new Map(allModules.map((m) => [m.id, m])), [allModules])
  const lookupTargetOf = (f: FieldT): ModuleT | null => {
    if (canonicalType(f.fieldType) !== 'lookup') return null
    const id = String(parseOptions(f.fieldOptions).lookupModuleId ?? '')
    return id ? (moduleById.get(id) ?? null) : null
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm">Fields &amp; Layout</CardTitle>
          <CardDescription>Drag fields between sections, or use the arrows</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={addSection}><Plus className="mr-1 size-3.5" /> Section</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="New field label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addField() }}
            className="h-8 min-w-0"
          />
          <Select value={newType} onValueChange={setNewType}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectTrigger className="h-8 w-full min-w-0 sm:w-44" aria-label="Field type"><SelectValue className="truncate" /></SelectTrigger>
              </TooltipTrigger>
              <TooltipContent>{typeLabel(newType)}</TooltipContent>
            </Tooltip>
            <SelectContent>
              {FIELD_TYPE_GROUPS.map((g) => (
                <SelectGroup key={g.group}>
                  <SelectLabel>{g.group}</SelectLabel>
                  {g.types.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={addField} disabled={adding || !newLabel.trim()} className="shrink-0">
            {adding ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Plus className="mr-1 size-3.5" />} Add field
          </Button>
        </div>

        {groups.map(({ section, items }) => (
          <div
            key={section.name}
            className={`rounded-lg border p-3 transition-colors ${dropHint === section.name ? 'border-primary bg-primary/5' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDropHint(section.name) }}
            onDragLeave={() => setDropHint((h) => (h === section.name ? null : h))}
            onDrop={(e) => {
              e.preventDefault()
              setDropHint(null)
              const id = e.dataTransfer.getData('text/plain') || dragId
              if (id) moveField(id, section.name, null)
            }}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <GripVertical className="size-3.5 text-muted-foreground" />
              {sectionEdits[section.name] !== undefined ? (
                <Input
                  autoFocus
                  value={sectionEdits[section.name]}
                  onChange={(e) => setSectionEdits((s) => ({ ...s, [section.name]: e.target.value }))}
                  onBlur={() => renameSection(section.name)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  className="h-7 w-40"
                  aria-label="Section name"
                />
              ) : (
                <button
                  type="button"
                  className="truncate text-sm font-medium underline-offset-2 hover:underline"
                  title="Click to rename"
                  onClick={() => setSectionEdits((s) => ({ ...s, [section.name]: section.name }))}
                >
                  {section.name}
                </button>
              )}
              <Badge variant="outline" className="text-[10px]">{items.length} fields</Badge>
              <div className="ml-auto flex items-center gap-2">
                <Select value={String(section.columns)} onValueChange={(v) => patchSection(section.name, { columns: Number(v) === 1 ? 1 : 2 })}>
                  <SelectTrigger className="h-7 w-[86px] text-xs" aria-label="Columns"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 column</SelectItem>
                    <SelectItem value="2">2 columns</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5">
                  <Switch
                    id={`coll-${section.name}`}
                    checked={section.collapsible}
                    onCheckedChange={(v) => patchSection(section.name, { collapsible: v })}
                    aria-label="Collapsible"
                  />
                  <Label htmlFor={`coll-${section.name}`} className="text-xs text-muted-foreground">Collapsible</Label>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={`Remove section ${section.name}`}
                  onClick={() => removeSection(section.name)}
                >
                  <Trash2 className="size-3.5 text-muted-foreground" />
                </Button>
              </div>
            </div>
            {items.length === 0 ? (
              <p className="rounded border border-dashed py-4 text-center text-xs text-muted-foreground">Drop fields here</p>
            ) : (
              <ul className="space-y-1.5">
                {items.map((f) => (
                  <li
                    key={f.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', f.id); e.dataTransfer.effectAllowed = 'move'; setDragId(f.id) }}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault(); e.stopPropagation()
                      setDropHint(null)
                      const id = e.dataTransfer.getData('text/plain') || dragId
                      if (id && id !== f.id) moveField(id, f.section ?? sections[0]?.name ?? 'General', f.id)
                    }}
                    className={`flex cursor-grab flex-wrap items-center gap-2 rounded border bg-background p-2 transition ${dragId === f.id ? 'opacity-40' : 'hover:bg-muted/30'}`}
                  >
                    <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="min-w-0 max-w-[9rem] shrink-0 truncate text-[10px]">{typeLabel(f.fieldType)}</Badge>
                      </TooltipTrigger>
                      <TooltipContent>{typeLabel(f.fieldType)}</TooltipContent>
                    </Tooltip>
                    <span className="min-w-0 flex-1 truncate text-sm" title={f.label}>{f.label}</span>
                    {/* Lookup target: inline on desktop, wraps below the label on mobile. */}
                    {(() => {
                      const target = lookupTargetOf(f)
                      if (!target) return null
                      return (
                        <span
                          className="w-full min-w-0 truncate text-xs text-muted-foreground sm:w-auto sm:max-w-[12rem]"
                          title={`Lookup → ${target.name}`}
                        >
                          → {target.name}
                        </span>
                      )
                    })()}
                    <span className="hidden min-w-0 max-w-full truncate font-mono text-xs text-muted-foreground sm:inline" title={f.apiName}>{f.apiName}</span>
                    {f.isRequired && <Badge variant="secondary" className="shrink-0 text-[10px]">required</Badge>}
                    {f.isUnique && <Badge variant="secondary" className="shrink-0 text-[10px]">unique</Badge>}
                    {f.isReadOnly && <Badge variant="secondary" className="shrink-0 text-[10px]">read-only</Badge>}
                    {depOf(f) && <Badge variant="secondary" className="shrink-0 text-[10px]">dependent</Badge>}
                    <div className="flex shrink-0 items-center">
                      <Button size="icon" variant="ghost" className="size-7" aria-label={`Move ${f.label} up`} onClick={() => nudge(f.id, -1)}><ChevronUp className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-7" aria-label={`Move ${f.label} down`} onClick={() => nudge(f.id, 1)}><ChevronDown className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-7" aria-label={`Edit ${f.label}`} onClick={() => setEditFieldId(f.id)}><Settings2 className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-7" aria-label={`Delete ${f.label}`} onClick={() => setDeleteField(f)}><Trash2 className="size-3.5 text-destructive" /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>

      <FieldSettingsDialog
        open={!!editField}
        onOpenChange={(o) => { if (!o) setEditFieldId(null) }}
        mod={mod}
        field={editField}
        fields={fields}
        sections={sections}
        allModules={allModules}
        onSaved={onRefresh}
      />

      <AlertDialog open={!!deleteField} onOpenChange={(o) => { if (!o) setDeleteField(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete field “{deleteField?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The field definition is removed. Existing record data keyed by <span className="break-all font-mono">{deleteField?.apiName}</span> is kept but will no longer be shown.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDeleteField} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 5.2 — Lookup target module combobox (searchable, fully scrollable)
// ---------------------------------------------------------------------------

function ModuleLookupCombobox({ value, onChange, modules }: {
  value: string
  onChange: (moduleId: string) => void
  modules: ModuleT[]
}) {
  const [open, setOpen] = React.useState(false)
  const selected = modules.find((m) => m.id === value) ?? null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label="Target module"
              className="h-8 w-full justify-between px-3 font-normal"
            >
              <span className="min-w-0 truncate">{selected ? selected.name : 'Choose a module'}</span>
              <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        {selected && <TooltipContent>{selected.name}</TooltipContent>}
      </Tooltip>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search modules…" />
          <CommandList className="max-h-64 overflow-y-auto">
            <CommandEmpty>No module found</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="none"
                onSelect={() => { onChange(''); setOpen(false) }}
              >
                <Check className={value ? 'opacity-0' : 'opacity-100'} aria-hidden />
                None
              </CommandItem>
              {modules.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.name} ${m.slug}`}
                  onSelect={() => { onChange(m.id); setOpen(false) }}
                >
                  <Check className={value === m.id ? 'opacity-100' : 'opacity-0'} aria-hidden />
                  <span className="min-w-0 truncate">{m.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// 5.2 — Field settings dialog
// ---------------------------------------------------------------------------

function FieldSettingsDialog({ open, onOpenChange, mod, field, fields, sections, allModules, onSaved }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  mod: ModuleT
  field: FieldT | null
  fields: FieldT[]
  sections: SectionT[]
  allModules: ModuleT[]
  onSaved: () => Promise<void> | void
}) {
  const [label, setLabel] = React.useState('')
  const [apiName, setApiName] = React.useState('')
  const [fieldType, setFieldType] = React.useState('single_line')
  const [isRequired, setIsRequired] = React.useState(false)
  const [isUnique, setIsUnique] = React.useState(false)
  const [isReadOnly, setIsReadOnly] = React.useState(false)
  const [defaultValue, setDefaultValue] = React.useState('')
  const [helpText, setHelpText] = React.useState('')
  const [section, setSection] = React.useState('')
  const [depOn, setDepOn] = React.useState(false)
  const [depField, setDepField] = React.useState('')
  const [depValue, setDepValue] = React.useState('')
  const [options, setOptions] = React.useState<string[]>([])
  const [formulaExpr, setFormulaExpr] = React.useState('')
  const [autoPrefix, setAutoPrefix] = React.useState('')
  const [lookupModuleId, setLookupModuleId] = React.useState('')
  const [accept, setAccept] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!field) return
    setLabel(field.label); setApiName(field.apiName); setFieldType(field.fieldType)
    setIsRequired(field.isRequired); setIsUnique(field.isUnique); setIsReadOnly(field.isReadOnly)
    setDefaultValue(field.defaultValue ?? ''); setHelpText(field.helpText ?? '')
    setSection(field.section ?? sections[0]?.name ?? 'General')
    const dep = depOf(field)
    setDepOn(!!dep); setDepField(dep?.field ?? ''); setDepValue(dep?.value ?? '')
    const o = parseOptions(field.fieldOptions)
    setOptions(Array.isArray(o.options) ? o.options.map((v) => String(v)) : [''])
    setFormulaExpr(String(o.formula ?? ''))
    setAutoPrefix(String(o.prefix ?? ''))
    setLookupModuleId(String(o.lookupModuleId ?? ''))
    setAccept(String(o.accept ?? ''))
  }, [field, sections])

  if (!field) return null
  const t = canonicalType(fieldType)
  const hasOptions = t === 'picklist' || t === 'multiselect' || t === 'radio'
  const hasFormula = t === 'formula'
  const hasPrefix = t === 'autonumber'
  const hasLookup = t === 'lookup'
  const hasAccept = t === 'file' || t === 'image'

  const save = async () => {
    if (!label.trim()) { toast.error('Label is required'); return }
    setSaving(true)
    try {
      const fieldOptions: AnyRecord = {}
      if (hasOptions) fieldOptions.options = options.map((o) => o.trim()).filter(Boolean)
      if (hasFormula) fieldOptions.formula = formulaExpr.trim()
      if (hasPrefix) fieldOptions.prefix = autoPrefix.trim()
      if (hasLookup) fieldOptions.lookupModuleId = lookupModuleId
      if (hasAccept) fieldOptions.accept = accept.trim()
      const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, {
        action: 'update_field',
        fieldId: field.id,
        label: label.trim(),
        apiName: apiName.trim() || field.apiName,
        fieldType,
        isRequired, isUnique, isReadOnly,
        defaultValue: defaultValue === '' ? null : defaultValue,
        helpText: helpText.trim() || null,
        section,
        fieldOptions,
        dependency: depOn && depField ? { field: depField, value: depValue } : null,
      })
      if (!ok) { toast.error(data.error || 'Update failed'); return }
      toast.success('Field updated')
      onOpenChange(false)
      await onSaved()
    } finally { setSaving(false) }
  }

  const previewExpr = hasFormula && formulaExpr.trim() ? fmtFormula(evaluateFormula(formulaExpr.trim(), {})) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Field settings — {field.label}</DialogTitle>
          <DialogDescription>
            Configure behaviour and type-specific options. Changing the API name will not migrate existing record data.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="f-label" className="text-xs">Label</Label>
              <Input id="f-label" value={label} onChange={(e) => setLabel(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-api" className="text-xs">API name</Label>
              <Input id="f-api" value={apiName} onChange={(e) => setApiName(e.target.value)} className="h-8 font-mono text-xs" />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={fieldType} onValueChange={setFieldType}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SelectTrigger className="h-8 w-full min-w-0"><SelectValue className="truncate" /></SelectTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{typeLabel(fieldType)}</TooltipContent>
                </Tooltip>
                <SelectContent>
                  {FIELD_TYPE_GROUPS.map((g, gi) => {
                    // Render the current type exactly ONCE: if it belongs to no
                    // group (legacy/unknown), append it to the last group only.
                    // Injecting it into every group created duplicate SelectItems
                    // with the same value, which Radix renders concatenated.
                    const known = FIELD_TYPE_GROUPS.some((gg) => gg.types.includes(fieldType))
                    const isLast = gi === FIELD_TYPE_GROUPS.length - 1
                    const types = !known && isLast ? [...g.types, fieldType] : g.types
                    return (
                      <SelectGroup key={g.group}>
                        <SelectLabel>{g.group}</SelectLabel>
                        {types.map((ty) => <SelectItem key={ty} value={ty}>{typeLabel(ty)}</SelectItem>)}
                      </SelectGroup>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Section</Label>
              <Select value={section} onValueChange={setSection}>
                <SelectTrigger className="h-8 w-full min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>{sections.map((s) => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-2"><Label htmlFor="f-req" className="text-xs">Mandatory</Label><Switch id="f-req" checked={isRequired} onCheckedChange={setIsRequired} /></div>
            <div className="flex items-center justify-between gap-2"><Label htmlFor="f-uniq" className="text-xs">Unique</Label><Switch id="f-uniq" checked={isUnique} onCheckedChange={setIsUnique} /></div>
            <div className="flex items-center justify-between gap-2"><Label htmlFor="f-ro" className="text-xs">Read-only</Label><Switch id="f-ro" checked={isReadOnly} onCheckedChange={setIsReadOnly} /></div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="f-default" className="text-xs">Default value</Label>
              {t === 'checkbox' ? (
                <Select value={defaultValue === 'true' ? 'true' : 'false'} onValueChange={setDefaultValue}>
                  <SelectTrigger className="h-8 w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="false">Unchecked</SelectItem><SelectItem value="true">Checked</SelectItem></SelectContent>
                </Select>
              ) : hasOptions && t !== 'multiselect' ? (
                <Select value={defaultValue} onValueChange={setDefaultValue}>
                  <SelectTrigger className="h-8 w-full min-w-0"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {options.filter((o) => o.trim()).map((o) => <SelectItem key={o} value={o.trim()}>{o.trim()}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="f-default"
                  value={defaultValue}
                  onChange={(e) => setDefaultValue(e.target.value)}
                  className="h-8"
                  type={['number', 'currency', 'percent', 'decimal', 'rating'].includes(t) ? 'number' : ['date', 'datetime', 'time'].includes(t) ? t : 'text'}
                  placeholder={t === 'multiselect' ? 'Comma-separated values' : 'Default value'}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-help" className="text-xs">Tooltip / help text</Label>
              <Input id="f-help" value={helpText} onChange={(e) => setHelpText(e.target.value)} className="h-8" placeholder="Shown under the input in forms" />
            </div>
          </div>

          {hasOptions && (
            <div className="space-y-1.5">
              <Label className="text-xs">Choices</Label>
              {options.map((o, i) => (
                <div key={i} className="flex min-w-0 gap-2">
                  <Input
                    value={o}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
                    className="h-8 min-w-0 flex-1"
                    placeholder={`Choice ${i + 1}`}
                    aria-label={`Choice ${i + 1}`}
                  />
                  <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label={`Remove choice ${i + 1}`} onClick={() => setOptions(options.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setOptions([...options, ''])}><Plus className="mr-1 size-3.5" /> Add choice</Button>
            </div>
          )}

          {hasFormula && (
            <div className="space-y-1.5">
              <Label htmlFor="f-formula" className="text-xs">Formula expression</Label>
              <Input id="f-formula" value={formulaExpr} onChange={(e) => setFormulaExpr(e.target.value)} className="h-8 min-w-0 font-mono text-xs" placeholder="price * quantity * (1 - discount)" />
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                Numeric fields: {fields.filter((f) => ['number', 'currency', 'percent', 'decimal', 'rating'].includes(canonicalType(f.fieldType))).map((f) => f.apiName).join(', ') || 'none yet'} — supports + − * / ( )
                {previewExpr !== null && <> · evaluates to <span className="font-mono">{previewExpr}</span> with empty data</>}
              </p>
            </div>
          )}

          {hasPrefix && (
            <div className="space-y-1.5">
              <Label htmlFor="f-prefix" className="text-xs">Auto number prefix</Label>
              <Input id="f-prefix" value={autoPrefix} onChange={(e) => setAutoPrefix(e.target.value)} className="h-8 font-mono" placeholder="e.g. INV-" />
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Server generates <span className="font-mono">{autoPrefix || 'PREFIX'}0001</span>, {autoPrefix || 'PREFIX'}0002 … per record (max existing + 1).</p>
            </div>
          )}

          {hasLookup && (
            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs">Target module</Label>
              <ModuleLookupCombobox
                value={lookupModuleId}
                onChange={setLookupModuleId}
                modules={allModules.filter((m) => m.id !== mod.id)}
              />
              <p className="text-xs text-muted-foreground">Record forms will offer a select of this module&apos;s records.</p>
            </div>
          )}

          {hasAccept && (
            <div className="space-y-1.5">
              <Label htmlFor="f-accept" className="text-xs">Accept hint</Label>
              <Input id="f-accept" value={accept} onChange={(e) => setAccept(e.target.value)} className="h-8" placeholder={t === 'image' ? 'image/png, image/jpeg' : '.pdf, .docx'} />
              <p className="text-xs text-muted-foreground">Records store a file URL — no real upload in this sandbox.</p>
            </div>
          )}

          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label htmlFor="f-dep" className="text-xs">Field dependency</Label>
                <p className="text-xs text-muted-foreground">Hide this field unless another field has a specific value</p>
              </div>
              <Switch id="f-dep" checked={depOn} onCheckedChange={setDepOn} />
            </div>
            {depOn && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Parent field</Label>
                  <Select value={depField || 'none'} onValueChange={(v) => setDepField(v === 'none' ? '' : v)}>
                    <SelectTrigger className="h-8 w-full min-w-0"><SelectValue placeholder="Choose field" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {fields.filter((f) => f.id !== field.id).map((f) => <SelectItem key={f.id} value={f.apiName}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="f-depval" className="text-xs">Show when value equals</Label>
                  <Input id="f-depval" value={depValue} onChange={(e) => setDepValue(e.target.value)} className="h-8" placeholder="e.g. Won" />
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null} Save field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 5.4 (views) — Custom views card
// ---------------------------------------------------------------------------

function ViewsCard({ mod, fields, views, onSaved }: { mod: ModuleT; fields: FieldT[]; views: ViewT[]; onSaved: () => Promise<void> | void }) {
  const [name, setName] = React.useState('')
  const [rows, setRows] = React.useState<{ apiName: string; value: string }[]>([])
  const [saving, setSaving] = React.useState(false)

  const saveViews = async (next: ViewT[]) => {
    const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, { action: 'update_views', views: next })
    if (!ok) { toast.error(data.error || 'Could not save views'); return }
    await onSaved()
  }

  const create = async () => {
    const n = name.trim()
    if (!n || saving) return
    if (views.some((v) => v.name.toLowerCase() === n.toLowerCase())) { toast.error('A view with that name exists'); return }
    setSaving(true)
    try {
      const filters: Record<string, string> = {}
      for (const r of rows) if (r.apiName) filters[r.apiName] = r.value
      await saveViews([...views, { name: n, filters }])
      toast.success('View created')
      setName(''); setRows([])
    } finally { setSaving(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Custom Views</CardTitle>
        <CardDescription>Filters applied to the records list below</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {views.length === 0 && <p className="text-xs text-muted-foreground">No custom views yet — “All records” is always available.</p>}
        {views.map((v, i) => (
          <div key={`${v.name}-${i}`} className="flex items-center gap-2 rounded border p-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{v.name}</span>
            <span className="hidden truncate font-mono text-xs text-muted-foreground sm:block">
              {Object.entries(v.filters).map(([k, val]) => `${k}=${val}`).join(' · ') || 'no filters'}
            </span>
            <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`Delete view ${v.name}`} onClick={() => { saveViews(views.filter((_, j) => j !== i)); toast.success('View deleted') }}>
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          </div>
        ))}
        <div className="rounded-lg border border-dashed p-3 space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="View name" className="h-8" />
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <Select value={r.apiName || 'none'} onValueChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, apiName: v === 'none' ? '' : v } : x)))}>
                <SelectTrigger className="h-8 w-full min-w-0 sm:w-40 sm:shrink-0" aria-label="Filter field"><SelectValue placeholder="Field" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Field…</SelectItem>
                  {fields.map((f) => <SelectItem key={f.id} value={f.apiName}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input value={r.value} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="Value" className="h-8" />
              <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label={`Remove filter ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setRows([...rows, { apiName: '', value: '' }])}><Plus className="mr-1 size-3.5" /> Filter</Button>
            <Button size="sm" onClick={create} disabled={!name.trim() || saving}>
              {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Plus className="mr-1 size-3.5" />} Create view
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 5.5 — Relations card
// ---------------------------------------------------------------------------

function RelationsCard({ mod, relations, allModules, onSaved }: { mod: ModuleT; relations: RelationT[]; allModules: ModuleT[]; onSaved: () => Promise<void> | void }) {
  const [name, setName] = React.useState('')
  const [type, setType] = React.useState<RelationType>('one_to_many')
  const [parentId, setParentId] = React.useState(mod.id)
  const [childId, setChildId] = React.useState('')
  const [childField, setChildField] = React.useState('')
  const [childFields, setChildFields] = React.useState<FieldT[]>([])
  const [saving, setSaving] = React.useState(false)
  const modById = React.useMemo(() => new Map(allModules.map((m) => [m.id, m])), [allModules])

  React.useEffect(() => {
    if (!childId) { setChildFields([]); return }
    let alive = true
    fetch(`/api/custom-modules/${childId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (alive) setChildFields(j.fields ?? []) })
      .catch(() => { if (alive) setChildFields([]) })
    return () => { alive = false }
  }, [childId])

  const create = async () => {
    if (!name.trim() || !childId || !childField || saving) { if (!name.trim() || !childId || !childField) toast.error('Name, child module and lookup field are required'); return }
    setSaving(true)
    try {
      const { ok, data } = await apiPost('/api/custom-modules/relations', { name: name.trim(), parentModuleId: parentId, childModuleId: childId, childFieldApiName: childField, type })
      if (!ok) { toast.error(data.error || 'Could not create relation'); return }
      toast.success('Relation created')
      setName(''); setChildField('')
      await onSaved()
    } finally { setSaving(false) }
  }

  const remove = async (rel: RelationT) => {
    const res = await fetch(`/api/custom-modules/relations/${rel.id}`, { method: 'DELETE' })
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Delete failed'); return }
    toast.success('Relation deleted')
    await onSaved()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Related Lists</CardTitle>
        <CardDescription>Link modules — child records surface on parent records</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {relations.length === 0 && <p className="text-xs text-muted-foreground">No relations yet.</p>}
        {relations.map((rel) => {
          const isParent = rel.parentModuleId === mod.id
          const other = isParent ? modById.get(rel.childModuleId) : modById.get(rel.parentModuleId)
          return (
            // min-w-0 + flex-wrap: a long relation/module name can never push
            // the row wider than the card — it truncates or wraps instead.
            <div key={rel.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded border p-2">
              <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={rel.name}>{rel.name}</span>
              <Badge variant="outline" className="shrink-0 text-[10px]">{rel.type === 'many_to_many' ? 'M:N' : '1:N'}</Badge>
              <Badge variant="secondary" className="min-w-0 max-w-[10rem] truncate text-[10px]">{isParent ? `→ ${other?.name ?? 'module'}` : `${other?.name ?? 'module'} → this`}</Badge>
              <span className="hidden min-w-0 truncate font-mono text-[10px] text-muted-foreground md:block">{rel.childFieldApiName}</span>
              <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`Delete relation ${rel.name}`} onClick={() => remove(rel)}>
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          )
        })}
        <div className="rounded-lg border border-dashed p-3 space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Relation name (e.g. Deals)" className="h-8" />
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">Parent module</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger className="h-8 w-full min-w-0" aria-label="Parent module"><SelectValue /></SelectTrigger>
                <SelectContent>{allModules.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">Child module</Label>
              <Select value={childId || 'none'} onValueChange={(v) => { setChildId(v === 'none' ? '' : v); setChildField('') }}>
                <SelectTrigger className="h-8 w-full min-w-0" aria-label="Child module"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Choose…</SelectItem>
                  {allModules.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as RelationType)}>
                <SelectTrigger className="h-8 w-full min-w-0" aria-label="Relation type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_to_many">1:N (one parent per child)</SelectItem>
                  <SelectItem value="many_to_many">M:N (many parents per child)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">Child lookup field</Label>
              <Select value={childField || 'none'} onValueChange={(v) => setChildField(v === 'none' ? '' : v)} disabled={!childId}>
                <SelectTrigger className="h-8 w-full min-w-0" aria-label="Child lookup field"><SelectValue placeholder={childId ? 'Choose field…' : 'Pick child first'} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Choose…</SelectItem>
                  {childFields.map((f) => <SelectItem key={f.id} value={f.apiName}>{f.label} <span className="ml-1 font-mono text-[10px] text-muted-foreground">{f.apiName}</span></SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button size="sm" onClick={create} disabled={saving}>
            {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Plus className="mr-1 size-3.5" />} Create relation
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Records card — view selector, quick create, record dialog
// ---------------------------------------------------------------------------

function RecordsCard({ detail, onSaved }: { detail: DetailT; onSaved: () => Promise<void> | void }) {
  const { module: mod, fields, records, views, relations, sections } = detail
  const [activeView, setActiveView] = React.useState('all')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<RecordT | null>(null)
  const [quickOpen, setQuickOpen] = React.useState(false)
  const [deleteRec, setDeleteRec] = React.useState<RecordT | null>(null)

  const filtered = activeView === 'all' ? records : records.filter((r) => viewMatches(r, views.find((v) => v.name === activeView)?.filters ?? {}))

  const openCreate = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (r: RecordT) => { setEditing(r); setDialogOpen(true) }

  const doDelete = async () => {
    if (!deleteRec) return
    const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, { action: 'delete_record', recordId: deleteRec.id })
    if (!ok) { toast.error(data.error || 'Delete failed'); return }
    toast.success('Record deleted')
    setDeleteRec(null)
    await onSaved()
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0 flex-wrap">
        <div className="min-w-0 flex-1">
          <CardTitle className="text-sm">Records</CardTitle>
          <CardDescription>{filtered.length} of {records.length} shown{activeView !== 'all' ? ` · view: ${activeView}` : ''}</CardDescription>
        </div>
        <Select value={activeView} onValueChange={setActiveView}>
          <SelectTrigger className="h-8 w-44" aria-label="View selector"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All records</SelectItem>
            {views.map((v) => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setQuickOpen(true)} aria-haspopup="dialog">
          <Zap className="mr-1 size-3.5" /> Quick create
        </Button>
        <Button size="sm" onClick={openCreate}><Plus className="mr-1 size-3.5" /> New record</Button>
      </CardHeader>
      <CardContent className="p-0">
        {!records ? null : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{records.length === 0 ? 'No records yet' : 'No records match this view'}</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {filtered.map((r) => (
              <li key={r.id}>
                <div className="flex w-full items-center gap-2 p-2 pl-3 text-sm hover:bg-muted/30">
                  <button type="button" onClick={() => openEdit(r)} className="min-w-0 flex-1 truncate text-left font-medium underline-offset-2 hover:underline" title="Open record">
                    {recordName(r, mod)}
                  </button>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">created {fmtDate(r.createdAt)}</span>
                  <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`Delete ${recordName(r, mod)}`} onClick={() => setDeleteRec(r)}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <RecordDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mod={mod}
        fields={fields}
        sections={sections}
        relations={relations}
        record={editing}
        onSaved={onSaved}
      />

      {/* Quick create: same full-field form + validation as the record dialog */}
      <QuickCreateDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        mod={mod}
        fields={fields}
        sections={sections}
        relations={relations}
        onSaved={onSaved}
      />

      <AlertDialog open={!!deleteRec} onOpenChange={(o) => { if (!o) setDeleteRec(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete record “{deleteRec ? recordName(deleteRec, mod) : ''}”?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the record and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 5.3 + 5.4 + 6 — Record create/edit dialog (sections, per-type inputs, related lists)
// ---------------------------------------------------------------------------

interface MemberT { id: string; name: string; email: string }

// ---------------------------------------------------------------------------
// Shared record-form plumbing — used by RecordDialog AND QuickCreateDialog so
// quick create renders every field type with zero missing inputs.
// ---------------------------------------------------------------------------

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))

/** Seed form data: field defaults for create mode, existing values for edit. */
function seedRecordData(fields: FieldT[], record: RecordT | null): AnyRecord {
  const existing = record ? safeJsonParse<AnyRecord>(record.data, {}) : {}
  const seed: AnyRecord = {}
  if (!record) {
    for (const f of fields) {
      const t = canonicalType(f.fieldType)
      if (f.defaultValue === null || f.defaultValue === undefined || f.defaultValue === '') { seed[f.apiName] = t === 'checkbox' ? false : t === 'multiselect' ? [] : ''; continue }
      if (t === 'multiselect') seed[f.apiName] = f.defaultValue.split(',').map((s) => s.trim()).filter(Boolean)
      else if (t === 'checkbox') seed[f.apiName] = f.defaultValue === 'true'
      else seed[f.apiName] = f.defaultValue
    }
  } else {
    for (const f of fields) {
      const t = canonicalType(f.fieldType)
      const v = existing[f.apiName]
      seed[f.apiName] = t === 'multiselect' ? (Array.isArray(v) ? v.map(String) : []) : t === 'checkbox' ? v === true : (v ?? '')
    }
  }
  return seed
}

/** Required-field validation on visible, editable fields (dependency-hidden / read-only / formula / autonumber skipped). */
function validateRecordFields(fields: FieldT[], data: AnyRecord): Record<string, string> {
  const errs: Record<string, string> = {}
  for (const f of fields) {
    if (!fieldVisible(f, data) || f.isReadOnly) continue
    const t = canonicalType(f.fieldType)
    if (t === 'autonumber' || t === 'formula') continue
    if (!f.isRequired) continue
    const v = data[f.apiName]
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (t === 'checkbox' && v !== true)
    if (empty) errs[f.apiName] = `${f.label} is required`
  }
  return errs
}

/** Submit payload — computed / server-generated fields are excluded. */
function buildRecordData(fields: FieldT[], data: AnyRecord): AnyRecord {
  const recordData: AnyRecord = {}
  for (const f of fields) {
    const t = canonicalType(f.fieldType)
    if (t === 'formula' || t === 'autonumber') continue // computed / server-generated
    const v = data[f.apiName]
    if (v === undefined) continue
    recordData[f.apiName] = v
  }
  return recordData
}

/** Group fields per section (fields with an unknown section fall into the first one). */
function sectionedFields(fields: FieldT[], sections: SectionT[]): { section: SectionT; items: FieldT[] }[] {
  const groups = sections.map((s) => ({ section: s, items: fields.filter((f) => (f.section ?? sections[0]?.name ?? 'General') === s.name) }))
  const known = new Set(sections.map((s) => s.name))
  // Only fields whose section is SET but unknown are leftovers — null-section
  // fields already sit in the fallback (first) section via the coalesce above,
  // and double-bucketing them produced duplicate React keys.
  const leftovers = fields.filter((f) => f.section && !known.has(f.section))
  if (leftovers.length > 0 && groups.length > 0) groups[0].items.push(...leftovers)
  return groups
}

interface RenderFieldCtx {
  data: AnyRecord
  setVal: (apiName: string, v: unknown) => void
  members: MemberT[]
  remote: Record<string, { module: ModuleT; records: RecordT[] }>
  uploadingField: string | null
  uploadFileFor: (f: FieldT, file: File) => void
  /** Edit mode (autonumber shows its stored value instead of the placeholder). */
  editing: boolean
  mod: ModuleT
}

/** Per-type input renderer — one source of truth for every module field type. */
function renderModuleFieldInput(f: FieldT, ctx: RenderFieldCtx): React.ReactNode {
  const t = canonicalType(f.fieldType)
  const v = ctx.data[f.apiName]
  const ro = f.isReadOnly
  const cls = 'h-8'
  const setVal = ctx.setVal
  switch (t) {
    case 'multi_line':
      return <Textarea value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value)} disabled={ro} rows={3} className="min-h-9" />
    case 'email':
      return <Input type="email" value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value)} disabled={ro} className={cls} placeholder="name@company.com" />
    case 'phone':
      return <Input type="tel" value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value)} disabled={ro} className={cls} placeholder="+1 555 000 1234" />
    case 'url':
      return <Input type="url" value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value)} disabled={ro} className={cls} placeholder="https://" />
    case 'number':
      return <Input type="number" step="1" value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value === '' ? '' : Number(e.target.value))} disabled={ro} className={cls} />
    case 'decimal':
      return <Input type="number" step="any" value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value === '' ? '' : Number(e.target.value))} disabled={ro} className={cls} />
    case 'rating':
      return <Input type="number" min={1} max={5} value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value === '' ? '' : Number(e.target.value))} disabled={ro} className={cls} />
    case 'currency':
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
          <Input type="number" step="0.01" value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value === '' ? '' : Number(e.target.value))} disabled={ro} className={`${cls} pl-6`} />
        </div>
      )
    case 'percent':
      return (
        <div className="relative">
          <Input type="number" step="any" value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value === '' ? '' : Number(e.target.value))} disabled={ro} className={`${cls} pr-7`} />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
        </div>
      )
    case 'date':
      return <Input type="date" value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value)} disabled={ro} className={cls} />
    case 'datetime':
      return <Input type="datetime-local" value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value)} disabled={ro} className={cls} />
    case 'time':
      return <Input type="time" value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value)} disabled={ro} className={cls} />
    case 'picklist': {
      const opts = optionsList(f)
      return (
        <Select value={str(v) || 'none'} onValueChange={(x) => setVal(f.apiName, x === 'none' ? '' : x)} disabled={ro}>
          <SelectTrigger className={cls}><SelectValue placeholder="Choose…" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— None —</SelectItem>
            {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      )
    }
    case 'radio': {
      const opts = optionsList(f)
      return (
        <RadioGroup value={str(v)} onValueChange={(x) => setVal(f.apiName, x)} disabled={ro} className="flex flex-wrap gap-4">
          {opts.map((o) => (
            <div key={o} className="flex items-center gap-1.5">
              <RadioGroupItem value={o} id={`r-${f.id}-${o}`} />
              <Label htmlFor={`r-${f.id}-${o}`} className="text-sm font-normal">{o}</Label>
            </div>
          ))}
        </RadioGroup>
      )
    }
    case 'multiselect': {
      const opts = optionsList(f)
      const arr = Array.isArray(v) ? v.map(String) : []
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {opts.map((o) => (
            <div key={o} className="flex items-center gap-1.5">
              <Checkbox id={`m-${f.id}-${o}`} checked={arr.includes(o)} onCheckedChange={(c) => setVal(f.apiName, c ? [...arr, o] : arr.filter((x) => x !== o))} disabled={ro} />
              <Label htmlFor={`m-${f.id}-${o}`} className="text-sm font-normal">{o}</Label>
            </div>
          ))}
          {opts.length === 0 && <span className="text-xs text-muted-foreground">No choices configured — add them in field settings.</span>}
        </div>
      )
    }
    case 'checkbox':
      return (
        <div className="flex items-center gap-2">
          <Switch checked={v === true} onCheckedChange={(c) => setVal(f.apiName, c)} disabled={ro} id={`c-${f.id}`} />
          <Label htmlFor={`c-${f.id}`} className="text-sm font-normal text-muted-foreground">{v === true ? 'Yes' : 'No'}</Label>
        </div>
      )
    case 'lookup': {
      const targetId = String(parseOptions(f.fieldOptions).lookupModuleId ?? '')
      const target = targetId ? ctx.remote[targetId] : undefined
      const list = target?.records ?? []
      return (
        <Select value={str(v) || 'none'} onValueChange={(x) => setVal(f.apiName, x === 'none' ? '' : x)} disabled={ro || !targetId}>
          <SelectTrigger className={cls}><SelectValue placeholder={targetId ? (list.length ? 'Choose…' : 'No records in target module') : 'No target module set'} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— None —</SelectItem>
            {list.map((r) => <SelectItem key={r.id} value={r.id}>{recordName(r, target?.module ?? ctx.mod)}</SelectItem>)}
          </SelectContent>
        </Select>
      )
    }
    case 'owner':
      return (
        <Select value={str(v) || 'none'} onValueChange={(x) => setVal(f.apiName, x === 'none' ? '' : x)} disabled={ro}>
          <SelectTrigger className={cls}><SelectValue placeholder={ctx.members.length ? 'Choose member…' : 'No members'} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— None —</SelectItem>
            {ctx.members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} <span className="ml-1 text-xs text-muted-foreground">{m.email}</span></SelectItem>)}
          </SelectContent>
        </Select>
      )
    case 'formula': {
      const computed = evaluateFormula(String(parseOptions(f.fieldOptions).formula ?? ''), ctx.data)
      return <Input value={fmtFormula(computed)} readOnly disabled className={`${cls} font-mono`} placeholder="—" />
    }
    case 'autonumber':
      return <Input value={ctx.editing ? str(v) : ''} readOnly disabled className={`${cls} font-mono`} placeholder="Auto-generated on save" />
    case 'file':
      return (
        <div className="space-y-1.5">
          <Input value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value)} disabled={ro} className={cls} placeholder="Paste file URL (https://…)" />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={ro || ctx.uploadingField === f.apiName} onClick={() => document.getElementById(`upload-${f.id}`)?.click()}>
              {ctx.uploadingField === f.apiName ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Upload className="mr-1 size-3" />}
              {ctx.uploadingField === f.apiName ? 'Uploading…' : 'Upload file'}
            </Button>
            {typeof v === 'string' && v ? <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{v.split('/').pop() || v}</span> : null}
          </div>
          <input
            id={`upload-${f.id}`}
            type="file"
            accept={String(parseOptions(f.fieldOptions).accept ?? '')}
            className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void ctx.uploadFileFor(f, file) }}
          />
        </div>
      )
    case 'image':
      return (
        <div className="space-y-1.5">
          <Input value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value)} disabled={ro} className={cls} placeholder="Paste image URL (https://…)" />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={ro || ctx.uploadingField === f.apiName} onClick={() => document.getElementById(`upload-${f.id}`)?.click()}>
              {ctx.uploadingField === f.apiName ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Upload className="mr-1 size-3" />}
              {ctx.uploadingField === f.apiName ? 'Uploading…' : 'Upload image'}
            </Button>
            {typeof v === 'string' && v ? <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{v.split('/').pop() || v}</span> : null}
          </div>
          <input
            id={`upload-${f.id}`}
            type="file"
            accept={String(parseOptions(f.fieldOptions).accept ?? '') || 'image/*'}
            className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void ctx.uploadFileFor(f, file) }}
          />
          {typeof v === 'string' && (v.startsWith('http') || v.startsWith('/')) && (
            <img src={v} alt={`${f.label} preview`} className="h-16 w-16 rounded border object-cover" />
          )}
        </div>
      )
    default: // single_line, text and anything unknown — migration tolerant
      return <Input value={str(v)} onChange={(e) => setVal(f.apiName, e.target.value)} disabled={ro} className={cls} />
  }
}

/** Loads owner members + lookup/related-module records and handles file uploads for a module form. */
function useModuleFormRemote(open: boolean, fields: FieldT[], relations: RelationT[], modId: string, setVal: (apiName: string, v: unknown) => void) {
  const [members, setMembers] = React.useState<MemberT[]>([])
  const [remote, setRemote] = React.useState<Record<string, { module: ModuleT; records: RecordT[] }>>({})
  const [uploadingField, setUploadingField] = React.useState<string | null>(null)
  const setValRef = React.useRef(setVal)
  setValRef.current = setVal

  React.useEffect(() => {
    if (!open) return
    let alive = true
    fetch('/api/crm/members', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (alive) setMembers(j.members ?? []) }).catch(() => {})
    const needLookup = new Set<string>()
    for (const f of fields) {
      if (canonicalType(f.fieldType) === 'lookup') {
        const id = String(parseOptions(f.fieldOptions).lookupModuleId ?? '')
        if (id) needLookup.add(id)
      }
    }
    for (const rel of relations) if (rel.parentModuleId === modId) needLookup.add(rel.childModuleId)
    for (const id of needLookup) {
      fetch(`/api/custom-modules/${id}?records=true`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (alive && j.module) setRemote((prev) => ({ ...prev, [id]: { module: j.module, records: j.records ?? [] } })) })
        .catch(() => {})
    }
    return () => { alive = false }
  }, [open, fields, relations, modId])

  const uploadFileFor = React.useCallback(async (f: FieldT, file: File) => {
    setUploadingField(f.apiName)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/content/files/upload', { method: 'POST', body: fd })
      const raw = await res.text().catch(() => '')
      let payload: AnyRecord = {}
      try { payload = JSON.parse(raw) ?? {} } catch { /* error body may be non-JSON */ }
      if (!res.ok) throw new Error(typeof payload.error === 'string' && payload.error ? payload.error : `Upload failed (${res.status})`)
      const obj = (payload.file && typeof payload.file === 'object' ? payload.file : payload) as AnyRecord
      let url = typeof obj.url === 'string' && obj.url ? obj.url : typeof payload.fileUrl === 'string' ? payload.fileUrl : ''
      if (!url && typeof obj.id === 'string' && obj.id) url = `/api/content/files/${obj.id}?download=true`
      if (!url) throw new Error('Upload succeeded but no file URL was returned')
      setValRef.current(f.apiName, url)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploadingField(null)
    }
  }, [])

  return { members, remote, uploadingField, uploadFileFor }
}

function RecordDialog({ open, onOpenChange, mod, fields, sections, relations, record, onSaved }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  mod: ModuleT
  fields: FieldT[]
  sections: SectionT[]
  relations: RelationT[]
  record: RecordT | null
  onSaved: () => Promise<void> | void
}) {
  const editing = !!record
  const [data, setData] = React.useState<AnyRecord>({})
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  const setVal = (apiName: string, v: unknown) => {
    setData((d) => ({ ...d, [apiName]: v }))
    setErrors((e) => { if (!e[apiName]) return e; const c = { ...e }; delete c[apiName]; return c })
  }

  // owner members + lookup/child module records + file upload plumbing (shared with QuickCreateDialog)
  const { members, remote, uploadingField, uploadFileFor } = useModuleFormRemote(open, fields, relations, mod.id, setVal)

  /** Resolve a member id to a display name via the loaded members list; raw id as fallback. */
  const memberName = (id: string) => members.find((m) => m.id === id)?.name || id

  // seed form data on open / target change (defaults for create, values for edit)
  React.useEffect(() => {
    if (!open) return
    setErrors({})
    setData(seedRecordData(fields, record))
  }, [open, record, fields])

  const renderInput = (f: FieldT) => renderModuleFieldInput(f, { data, setVal, members, remote, uploadingField, uploadFileFor, editing, mod })

  const submit = async () => {
    // required validation on visible, editable fields (shared with QuickCreateDialog)
    const errs = validateRecordFields(fields, data)
    if (Object.keys(errs).length > 0) { setErrors(errs); toast.error('Please fix the highlighted fields'); return }
    setSaving(true)
    try {
      const recordData = buildRecordData(fields, data)
      const { ok, data: res } = await apiPost(`/api/custom-modules/${mod.id}`, editing
        ? { action: 'update_record', recordId: record!.id, recordData }
        : { action: 'create_record', recordData })
      if (!ok) {
        if (res.field) setErrors({ [res.field]: res.error || 'Invalid value' })
        toast.error(res.error || 'Save failed')
        return
      }
      toast.success(editing ? 'Record updated' : 'Record created')
      onOpenChange(false)
      await onSaved()
    } finally { setSaving(false) }
  }

  // group visible fields per section
  const groups = sectionedFields(fields, sections)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${mod.name}` : `New ${mod.name}`}</DialogTitle>
          <DialogDescription>{editing && record ? recordName(record, mod) : 'Fill in the fields below'}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {groups.map(({ section, items }) => {
            const body = (
              <div className={section.columns === 2 ? 'grid gap-3 md:grid-cols-2' : 'space-y-3'}>
                {items.map((f) => {
                  if (!fieldVisible(f, data)) return null
                  const err = errors[f.apiName]
                  const isRO = f.isReadOnly || canonicalType(f.fieldType) === 'formula' || canonicalType(f.fieldType) === 'autonumber'
                  return (
                    <div key={f.id} className={canonicalType(f.fieldType) === 'multi_line' && section.columns === 2 ? 'md:col-span-2' : ''}>
                      <div className="mb-1 flex items-center gap-1">
                        <Label htmlFor={`fld-${f.id}`} className="text-xs font-medium">{f.label}</Label>
                        {f.isRequired && !isRO && <span className="text-xs text-destructive">*</span>}
                        {isRO && <Badge variant="outline" className="text-[9px]">locked</Badge>}
                      </div>
                      {renderInput(f)}
                      {f.helpText && !err && <p className="mt-1 text-xs text-muted-foreground">{f.helpText}</p>}
                      {err && <p className="mt-1 text-xs text-destructive" role="alert">{err}</p>}
                    </div>
                  )
                })}
              </div>
            )
            if (!section.collapsible) return <section key={section.name} className="rounded-lg border p-3"><h3 className="mb-2 text-sm font-semibold">{section.name}</h3>{body}</section>
            return (
              <Collapsible key={section.name} defaultOpen className="rounded-lg border p-3">
                <CollapsibleTrigger className="group flex w-full items-center justify-between">
                  <h3 className="text-sm font-semibold">{section.name}</h3>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">{body}</CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>

        {editing && record && <RelatedLists mod={mod} record={record} relations={relations} remote={remote} onRefresh={onSaved} />}

        <DialogFooter className="flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-left text-xs text-muted-foreground">
            {record ? <>Created {fmtDate(record.createdAt)} · Modified {fmtDate(record.updatedAt)}</> : 'Timestamps are tracked automatically on save.'}
            {record && (record.createdById || record.modifiedById) && (
              <span className="block">
                {record.createdById ? `Created by ${memberName(record.createdById)}` : ''}
                {record.createdById && record.modifiedById ? ' · ' : ''}
                {record.modifiedById ? `Modified by ${memberName(record.modifiedById)}` : ''}
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null} {editing ? 'Save changes' : 'Create record'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Quick create — full-field create dialog. Renders EVERY module field with the
// same per-type renderer + validation as RecordDialog (defaults pre-filled),
// so nothing is silently missing like the old one-click "New Record".
// ---------------------------------------------------------------------------

function QuickCreateDialog({ open, onOpenChange, mod, fields, sections, relations, onSaved }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  mod: ModuleT
  fields: FieldT[]
  sections: SectionT[]
  relations: RelationT[]
  onSaved: () => Promise<void> | void
}) {
  const [data, setData] = React.useState<AnyRecord>({})
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  const setVal = (apiName: string, v: unknown) => {
    setData((d) => ({ ...d, [apiName]: v }))
    setErrors((e) => { if (!e[apiName]) return e; const c = { ...e }; delete c[apiName]; return c })
  }

  // seed defaults on open (same logic as RecordDialog create mode)
  React.useEffect(() => {
    if (!open) return
    setErrors({})
    setData(seedRecordData(fields, null))
  }, [open, fields])

  // lookup targets / owner members / file upload plumbing — same as RecordDialog
  const { members, remote, uploadingField, uploadFileFor } = useModuleFormRemote(open, fields, relations, mod.id, setVal)

  const submit = async () => {
    // validation identical to RecordDialog (required fields on visible, editable fields)
    const errs = validateRecordFields(fields, data)
    if (Object.keys(errs).length > 0) { setErrors(errs); toast.error('Please fix the highlighted fields'); return }
    setSaving(true)
    try {
      const recordData = buildRecordData(fields, data)
      const { ok, data: res } = await apiPost<{ error?: string; field?: string }>(`/api/custom-modules/${mod.id}`, { action: 'create_record', recordData })
      if (!ok) {
        if (res.field) setErrors({ [res.field]: res.error || 'Invalid value' })
        toast.error(res.error || 'Save failed')
        return
      }
      toast.success('Record created')
      onOpenChange(false)
      await onSaved() // refresh the records list in place — no page reload
    } finally { setSaving(false) }
  }

  const groups = sectionedFields(fields, sections)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 text-left">
          <DialogTitle>Quick create — {mod.name}</DialogTitle>
          <DialogDescription>Every field with its default pre-filled — same fields and validation as the full form.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {groups.map(({ section, items }) => {
            const body = (
              <div className={section.columns === 2 ? 'grid gap-3 md:grid-cols-2' : 'space-y-3'}>
                {items.map((f) => {
                  if (!fieldVisible(f, data)) return null
                  const err = errors[f.apiName]
                  const isRO = f.isReadOnly || canonicalType(f.fieldType) === 'formula' || canonicalType(f.fieldType) === 'autonumber'
                  return (
                    <div key={f.id} className={canonicalType(f.fieldType) === 'multi_line' && section.columns === 2 ? 'md:col-span-2' : ''}>
                      <div className="mb-1 flex items-center gap-1">
                        <Label htmlFor={`fld-${f.id}`} className="text-xs font-medium">{f.label}</Label>
                        {f.isRequired && !isRO && <span className="text-xs text-destructive">*</span>}
                        {isRO && <Badge variant="outline" className="text-[9px]">locked</Badge>}
                      </div>
                      {renderModuleFieldInput(f, { data, setVal, members, remote, uploadingField, uploadFileFor, editing: false, mod })}
                      {f.helpText && !err && <p className="mt-1 text-xs text-muted-foreground">{f.helpText}</p>}
                      {err && <p className="mt-1 text-xs text-destructive" role="alert">{err}</p>}
                    </div>
                  )
                })}
              </div>
            )
            if (!section.collapsible) return <section key={section.name} className="rounded-lg border p-3"><h3 className="mb-2 text-sm font-semibold">{section.name}</h3>{body}</section>
            return (
              <Collapsible key={section.name} defaultOpen className="rounded-lg border p-3">
                <CollapsibleTrigger className="group flex w-full items-center justify-between">
                  <h3 className="text-sm font-semibold">{section.name}</h3>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">{body}</CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t bg-background px-5 py-3">
          <p className="hidden text-xs text-muted-foreground sm:block">Required fields are validated before save.</p>
          <div className="flex flex-1 items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Zap className="mr-1 size-3.5" />}
              {saving ? 'Creating…' : 'Create record'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// 5.5 — Related lists inside the record dialog
// ---------------------------------------------------------------------------

function RelatedLists({ mod, record, relations, remote, onRefresh }: {
  mod: ModuleT
  record: RecordT
  relations: RelationT[]
  remote: Record<string, { module: ModuleT; records: RecordT[] }>
  onRefresh: () => Promise<void> | void
}) {
  const mine = relations.filter((r) => r.parentModuleId === mod.id)
  const [linkPick, setLinkPick] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<string | null>(null)
  if (mine.length === 0) return null

  const matches = (rel: RelationT, child: RecordT): boolean => {
    const d = safeJsonParse<AnyRecord>(child.data, {})
    const cur = d[rel.childFieldApiName]
    if (rel.type === 'many_to_many') return Array.isArray(cur) && cur.map(String).includes(record.id)
    return String(cur ?? '') === record.id
  }

  const link = async (rel: RelationT) => {
    const childRecordId = linkPick[rel.id]
    if (!childRecordId || busy) return
    setBusy(rel.id)
    try {
      const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, { action: 'link_related', recordId: record.id, relationId: rel.id, childRecordId })
      if (!ok) { toast.error(data.error || 'Link failed'); return }
      toast.success('Record linked')
      setLinkPick((p) => ({ ...p, [rel.id]: '' }))
      await onRefresh()
    } finally { setBusy(null) }
  }

  const unlink = async (rel: RelationT, childRecordId: string) => {
    if (busy) return
    setBusy(rel.id)
    try {
      const { ok, data } = await apiPost(`/api/custom-modules/${mod.id}`, { action: 'unlink_related', recordId: record.id, relationId: rel.id, childRecordId })
      if (!ok) { toast.error(data.error || 'Unlink failed'); return }
      toast.success('Record unlinked')
      await onRefresh()
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <h3 className="text-sm font-semibold">Related Lists</h3>
      {mine.map((rel) => {
        const child = remote[rel.childModuleId]
        const list = child?.records ?? []
        const linked = list.filter((r) => matches(rel, r))
        const unlinked = list.filter((r) => !matches(rel, r))
        return (
          <div key={rel.id} className="rounded-lg border p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={rel.name}>{rel.name}</span>
              <Badge variant="outline" className="shrink-0 text-[10px]">{rel.type === 'many_to_many' ? 'M:N' : '1:N'}</Badge>
              <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">{child?.module.pluralName ?? ''} · {linked.length} linked</span>
            </div>
            {linked.length > 0 ? (
              <ul className="mb-2 space-y-1">
                {linked.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded border bg-background p-1.5 pl-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{child ? recordName(r, child.module) : r.id}</span>
                    <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" disabled={busy === rel.id} onClick={() => unlink(rel, r.id)}>
                      <Unlink className="mr-1 size-3" /> Unlink
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-2 text-xs text-muted-foreground">No linked records yet.</p>
            )}
            <div className="flex gap-2">
              <Select value={linkPick[rel.id] || 'none'} onValueChange={(v) => setLinkPick((p) => ({ ...p, [rel.id]: v === 'none' ? '' : v }))}>
                <SelectTrigger className="h-8 flex-1" aria-label={`Link existing ${rel.name}`}><SelectValue placeholder={unlinked.length ? 'Link existing record…' : 'All records linked'} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Choose…</SelectItem>
                  {unlinked.map((r) => <SelectItem key={r.id} value={r.id}>{child ? recordName(r, child.module) : r.id}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={!linkPick[rel.id] || busy === rel.id} onClick={() => link(rel)}>
                <Link2 className="mr-1 size-3.5" /> Link
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
