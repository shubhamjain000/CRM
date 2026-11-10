'use client'

import * as React from 'react'
import { SlidersHorizontal, X, Plus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** One condition row: field + operator + value(s). */
export interface FilterCond {
  id: string
  field: string
  op: string
  value: string
  value2: string
  values: string[]
}

/** Filterable field definition shown in the builder dropdowns. */
export interface FilterFieldDef {
  key: string
  label: string
  type: 'text' | 'select' | 'number' | 'date' | 'boolean'
  options?: { value: string; label: string }[]
}

const newCond = (): FilterCond => ({
  id: crypto.randomUUID(),
  field: '',
  op: '',
  value: '',
  value2: '',
  values: [],
})

const OPS_BY_TYPE: Record<FilterFieldDef['type'], { value: string; label: string }[]> = {
  text: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: "doesn't contain" },
    { value: 'starts_with', label: 'starts with' },
  ],
  select: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'is_any_of', label: 'is any of' },
  ],
  number: [
    { value: 'greater', label: 'greater than' },
    { value: 'less', label: 'less than' },
    { value: 'between', label: 'between' },
    { value: 'is', label: 'is' },
  ],
  date: [
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'between', label: 'between' },
  ],
  boolean: [
    { value: 'is', label: 'is' },
  ],
}

const BOOL_OPTIONS = [
  { value: 'true', label: 'True' },
  { value: 'false', label: 'False' },
]

const hasValue = (c: FilterCond): boolean =>
  c.value.trim() !== '' || c.value2.trim() !== '' || c.values.length > 0

/**
 * Convert conditions to query params understood by the CRM list/export API
 * (suffix operators handled in src/lib/crm/handler.ts). Rows without a field
 * or without any value are skipped.
 */
export function condsToParams(conds: FilterCond[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of conds) {
    if (!c.field) continue
    const f = c.field
    const v = c.value.trim()
    const v2 = c.value2.trim()
    switch (c.op) {
      case 'is': if (v) out[f] = v; break
      case 'is_not': if (v) out[`${f}_ne`] = v; break
      case 'contains': if (v) out[`${f}_contains`] = v; break
      case 'not_contains': if (v) out[`${f}_not_contains`] = v; break
      case 'starts_with': if (v) out[`${f}_starts`] = v; break
      case 'is_any_of': if (c.values.length > 0) out[`${f}_in`] = c.values.join(','); break
      case 'greater': if (v) out[`${f}_gt`] = v; break
      case 'less': if (v) out[`${f}_lt`] = v; break
      case 'before': if (v) out[`${f}_lt`] = v; break
      case 'after': if (v) out[`${f}_gt`] = v; break
      case 'between':
        if (v) out[`${f}_gte`] = v
        if (v2) out[`${f}_lte`] = v2
        break
    }
  }
  return out
}

const OP_LABELS: Record<string, string> = {
  is: 'is', is_not: 'is not', contains: 'contains', not_contains: "doesn't contain",
  starts_with: 'starts with', is_any_of: 'is any of', greater: '>', less: '<',
  between: 'between', before: 'before', after: 'after',
}

/** Human-readable labels for the active-filter chips (e.g. "Rating is Hot"). */
export function describeConds(conds: FilterCond[], fields: FilterFieldDef[]): { key: string; label: string }[] {
  return conds
    .filter((c) => c.field && hasValue(c))
    .map((c) => {
      const field = fields.find((f) => f.key === c.field)
      const val =
        c.values.length > 0
          ? c.values.join(', ')
          : c.op === 'between' && (c.value.trim() || c.value2.trim())
            ? `${c.value.trim() || '?'} – ${c.value2.trim() || '?'}`
            : c.value.trim()
      return {
        key: c.id,
        label: `${field?.label ?? c.field} ${OP_LABELS[c.op] ?? c.op}${val ? ` ${val}` : ''}`,
      }
    })
}

interface Props {
  fields: FilterFieldDef[]
  conds: FilterCond[]
  onChange: (conds: FilterCond[]) => void
  /** Persist a named filter; return false (or throw) to keep the name input. */
  onSaveFilter?: (name: string) => void | boolean | Promise<void | boolean>
  savedCount?: number
  /** Extra classes for the trigger button (e.g. h-9 next to taller selects). */
  triggerClassName?: string
}

export function FilterBuilder({ fields, conds, onChange, onSaveFilter, savedCount = 0, triggerClassName }: Props) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<FilterCond[]>([])
  const [filterName, setFilterName] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const fieldByKey = React.useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields])

  // Every time the panel opens, work on a fresh copy of the committed conds.
  const openPanel = (next: boolean) => {
    if (next) {
      setDraft(conds.map((c) => ({ ...c, values: [...c.values] })))
      setFilterName('')
    }
    setOpen(next)
  }

  const updateRow = (id: string, patch: Partial<FilterCond>) => {
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const setRowField = (id: string, field: string) => {
    const def = fieldByKey.get(field)
    updateRow(id, { field, op: def ? OPS_BY_TYPE[def.type][0].value : '', value: '', value2: '', values: [] })
  }

  const activeCount = conds.filter((c) => c.field && hasValue(c)).length
  // A row with a field chosen but nothing to match on would be silently
  // skipped — surface that instead of hiding it (still non-blocking).
  const hasIncomplete = draft.some((c) => c.field && !hasValue(c))

  const apply = () => {
    onChange(draft.filter((c) => c.field && hasValue(c)))
    setOpen(false)
  }

  const saveFilter = async () => {
    const name = filterName.trim()
    if (!name || conds.length === 0 || saving) return
    try {
      setSaving(true)
      const res = await onSaveFilter?.(name)
      if (res !== false) setFilterName('')
    } catch {
      // Parent surfaces the error toast (e.g. the 10-filters-per-module cap).
    } finally {
      setSaving(false)
    }
  }

  const renderValueEditor = (c: FilterCond, def: FilterFieldDef | undefined) => {
    if (!def) return <Input disabled placeholder="Value" className="h-8 min-w-0 text-xs" />
    if (c.op === 'is_any_of') {
      const options = def.options ?? []
      if (options.length === 0) {
        return <Input value={c.value} onChange={(e) => updateRow(c.id, { value: e.target.value })} placeholder="Comma-separated values" className="h-8 min-w-0 text-xs" />
      }
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {options.map((o) => {
            const active = c.values.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => updateRow(c.id, { values: active ? c.values.filter((x) => x !== o.value) : [...c.values, o.value] })}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs transition',
                  active ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      )
    }
    if (def.type === 'boolean') {
      return (
        <Select value={c.value} onValueChange={(v) => updateRow(c.id, { value: v })}>
          <SelectTrigger className="h-8 min-w-0 text-xs" aria-label="Filter value">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            {BOOL_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    if (def.type === 'select' && (c.op === 'is' || c.op === 'is_not')) {
      return (
        <Select value={c.value} onValueChange={(v) => updateRow(c.id, { value: v === '__any__' ? '' : v })}>
          <SelectTrigger className="h-8 min-w-0 text-xs" aria-label="Filter value">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">Any</SelectItem>
            {(def.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    if (c.op === 'between') {
      const type = def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'
      return (
        <div className="flex min-w-0 items-center gap-1">
          <Input type={type} value={c.value} onChange={(e) => updateRow(c.id, { value: e.target.value })} placeholder="From" className="h-8 min-w-0 text-xs" />
          <span className="text-xs text-muted-foreground">–</span>
          <Input type={type} value={c.value2} onChange={(e) => updateRow(c.id, { value2: e.target.value })} placeholder="To" className="h-8 min-w-0 text-xs" />
        </div>
      )
    }
    const type = def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'
    return (
      <Input
        type={type}
        value={c.value}
        onChange={(e) => updateRow(c.id, { value: e.target.value })}
        placeholder="Value"
        className="h-8 min-w-0 text-xs"
      />
    )
  }

  return (
    <Popover open={open} onOpenChange={openPanel}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('h-8 text-xs', triggerClassName)} title="Build advanced filters">
          <SlidersHorizontal className="mr-1.5 size-3.5" /> Add Filter
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 font-mono text-[10px]">{activeCount}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] max-w-[calc(100vw-2rem)] p-3">
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {draft.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No conditions yet — add one to narrow the list.
            </p>
          )}
          {draft.map((c) => {
            const def = c.field ? fieldByKey.get(c.field) : undefined
            const ops = def ? OPS_BY_TYPE[def.type] : []
            return (
              <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-1.5">
                <Select value={c.field} onValueChange={(v) => setRowField(c.id, v)}>
                  <SelectTrigger className="h-8 min-w-0 text-xs" aria-label="Filter field">
                    <SelectValue placeholder="Field" />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((f) => (
                      <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={c.op} onValueChange={(v) => updateRow(c.id, { op: v, value: '', value2: '', values: [] })} disabled={!def}>
                  <SelectTrigger className="h-8 min-w-0 text-xs" aria-label="Filter operator">
                    <SelectValue placeholder="Op" />
                  </SelectTrigger>
                  <SelectContent>
                    {ops.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {renderValueEditor(c, def)}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label="Remove condition"
                  onClick={() => setDraft((rows) => rows.filter((r) => r.id !== c.id))}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
        {hasIncomplete && (
          <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            Conditions with a field but no value are ignored.
          </p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setDraft((rows) => [...rows, newCond()])}
          >
            <Plus className="mr-1 size-3.5" /> Add condition
          </Button>
          {draft.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setDraft([])}>
              Clear all
            </Button>
          )}
        </div>
        <div className="flex justify-end border-t pt-2">
          <Button size="sm" className="h-8 text-xs" onClick={apply}>
            Apply
          </Button>
        </div>
        <div className="mt-1 space-y-1.5 border-t pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Save this filter</span>
            <span className="text-[10px] text-muted-foreground">{savedCount}/10 saved</span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              placeholder="Filter name…"
              className="h-8 min-w-0 flex-1 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void saveFilter()
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={!filterName.trim() || conds.length === 0 || saving}
              onClick={() => void saveFilter()}
            >
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
