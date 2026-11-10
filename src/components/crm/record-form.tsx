'use client'

import * as React from 'react'
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, Save, Lock, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useFieldSecurity, securityKey } from './use-field-security'

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

export type FieldType =
  | 'text' | 'email' | 'phone' | 'url' | 'number' | 'currency'
  | 'date' | 'select' | 'textarea' | 'checkbox' | 'multiselect'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  options?: { value: string; label: string }[]
  required?: boolean
  full?: boolean
  section?: string
  placeholder?: string
  hint?: string
  /** select accepts an explicit empty choice ("— None —"); '' is sent as null */
  clearable?: boolean
}

/** Custom field definition as returned by GET /api/crm/custom-fields */
export interface CustomFieldDef {
  id: string
  module: string
  label: string
  apiName: string
  fieldType: string
  fieldOptions: Record<string, unknown>
  validationRules: Record<string, unknown>
  defaultValue: string | null
}

/** Custom field types this form can render & save. Others are skipped. */
const SUPPORTED_CUSTOM_TYPES = new Set([
  'text', 'long_text', 'rich_text', 'number', 'currency', 'percent', 'decimal',
  'date', 'datetime', 'time', 'email', 'phone', 'url', 'picklist',
  'multi_picklist', 'checkbox', 'rating', 'address',
])

const CUSTOM_UNSUPPORTED_NOTE: Record<string, string> = {
  lookup: 'Lookup fields are not editable in this form yet',
  subform: 'Subforms are not editable in this form yet',
  formula: 'Formula fields are calculated automatically',
  rollup_summary: 'Rollup fields are calculated automatically',
  file: 'File upload is not available in this form yet',
  image: 'Image upload is not available in this form yet',
}

export type CrmModule = 'lead' | 'contact' | 'account' | 'deal'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  fields: FieldDef[]
  initial?: Record<string, unknown>
  /** When provided, active custom fields for this module are appended under a dedicated section */
  module?: CrmModule
  /** Existing custom values (apiName -> value) for edit mode prefill */
  initialCustom?: Record<string, unknown> | null
  onSave: (data: Record<string, unknown>) => Promise<void>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#][^\s]*)?$/i

function sectionOf(f: FieldDef) {
  return f.section?.trim() || 'Information'
}

function displayCustomValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecordForm({
  open, onOpenChange, title, description, fields, initial, module, initialCustom, onSave,
}: Props) {
  const [values, setValues] = React.useState<Record<string, unknown>>({})
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  // Field security (Tier 3): hide fields hidden for the caller's role, render
  // read-only ones disabled. Custom fields (not in the catalog) are unaffected.
  // The hook degrades to "no restrictions" on load/failure — never blocks the UI.
  const { hiddenFor, isReadOnly } = useFieldSecurity()
  const stdFields = React.useMemo(
    () => (module ? fields.filter((f) => !hiddenFor(module).has(securityKey(f.key))) : fields),
    [fields, module, hiddenFor],
  )
  const fieldReadOnly = (key: string) => (module ? isReadOnly(module, securityKey(key)) : false)

  // Custom fields state
  const [customDefs, setCustomDefs] = React.useState<CustomFieldDef[] | null>(null)
  const [customValues, setCustomValues] = React.useState<Record<string, unknown>>({})
  /** apiNames the user actually touched — only these are sent so untouched values stay untouched */
  const touchedCustom = React.useRef<Set<string>>(new Set())
  const fieldRefs = React.useRef<Map<string, HTMLInputElement | HTMLTextAreaElement>>(new Map())
  /** Latest initial values by ref so the reset effect only fires on open transitions */
  const initialRef = React.useRef<{ initial?: Record<string, unknown>; initialCustom?: Record<string, unknown> | null }>({})
  initialRef.current = { initial, initialCustom }

  // Reset on open (only on open transitions — initial objects are recreated every parent render)
  React.useEffect(() => {
    if (!open) return
    const { initial: init, initialCustom: initCustom } = initialRef.current
    setValues(init ?? {})
    setErrors({})
    touchedCustom.current = new Set()
    setCustomValues(
      initCustom && typeof initCustom === 'object' ? { ...initCustom } : {},
    )
  }, [open])

  // Load custom field definitions (also callable after "Add field" creates one)
  const loadCustomDefs = React.useCallback((signal?: AbortSignal) => {
    if (!module) return
    fetch(`/api/crm/custom-fields?module=${module}`, { cache: 'no-store', signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load custom fields'))))
      .then((d) => setCustomDefs(
        (Array.isArray(d.fields) ? d.fields : []).filter((f: CustomFieldDef) => SUPPORTED_CUSTOM_TYPES.has(f.fieldType)),
      ))
      .catch(() => setCustomDefs([]))
  }, [module])

  React.useEffect(() => {
    if (!open || !module) { setCustomDefs(null); return }
    const ctrl = new AbortController()
    setCustomDefs(null)
    loadCustomDefs(ctrl.signal)
    return () => ctrl.abort()
  }, [open, module, loadCustomDefs])

  const set = (key: string, val: unknown) => {
    setValues((v) => ({ ...v, [key]: val }))
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e))
  }

  const setCustom = (apiName: string, val: unknown) => {
    touchedCustom.current.add(apiName)
    setCustomValues((v) => ({ ...v, [apiName]: val }))
  }

  // ----- inline "Add field" (admin extends the form right from here) -----

  const ADD_FIELD_TYPES = [
    { value: 'text', label: 'Free text' },
    { value: 'long_text', label: 'Long text' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'url', label: 'URL' },
    { value: 'picklist', label: 'Dropdown' },
    { value: 'multi_picklist', label: 'Multi-select dropdown' },
    { value: 'checkbox', label: 'Checkbox' },
  ]
  const ADD_FIELD_OPTIONS_TYPES = new Set(['picklist', 'multi_picklist'])

  const [addFieldOpen, setAddFieldOpen] = React.useState(false)
  const [addField, setAddField] = React.useState({ label: '', fieldType: 'text', optionsText: '', required: false })
  const [addFieldErrors, setAddFieldErrors] = React.useState<Record<string, string>>({})
  const [addFieldSaving, setAddFieldSaving] = React.useState(false)

  const submitAddField = async () => {
    const errs: Record<string, string> = {}
    const label = addField.label.trim()
    if (!label) errs.label = 'Label is required'
    const options = addField.optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
    if (ADD_FIELD_OPTIONS_TYPES.has(addField.fieldType) && options.length === 0) {
      errs.optionsText = 'Add at least one option (one per line)'
    }
    if (Object.keys(errs).length > 0) { setAddFieldErrors(errs); return }
    setAddFieldErrors({})
    // apiName derived from the label (server also validates uniqueness/format)
    const apiName = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'f$1').slice(0, 64) || `field_${Date.now()}`
    setAddFieldSaving(true)
    try {
      const res = await fetch('/api/crm/custom-fields', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module, label, apiName, fieldType: addField.fieldType,
          validationRules: addField.required ? { required: true } : {},
          ...(ADD_FIELD_OPTIONS_TYPES.has(addField.fieldType) ? { fieldOptions: { options } } : {}),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to create field')
      toast.success(`Field "${label}" added — it now appears in this form for every member`)
      setAddFieldOpen(false)
      setAddField({ label: '', fieldType: 'text', optionsText: '', required: false })
      loadCustomDefs()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create field')
    } finally {
      setAddFieldSaving(false)
    }
  }

  // ----- validation -----

  const validateStandard = (f: FieldDef): string => {
    const raw = values[f.key]
    const str = raw === null || raw === undefined ? '' : String(raw).trim()
    if (f.required) {
      if (f.type === 'checkbox') return ''
      if (f.type === 'number' || f.type === 'currency') {
        if (str === '' || Number.isNaN(Number(str))) return `${f.label} is required`
      } else if (str === '') return `${f.label} is required`
    }
    if (str === '') return ''
    if (f.type === 'email' && !EMAIL_RE.test(str)) return 'Enter a valid email address'
    if (f.type === 'url' && !URL_RE.test(str)) return 'Enter a valid URL (e.g. https://acme.com)'
    if ((f.type === 'number' || f.type === 'currency') && Number.isNaN(Number(str))) {
      return `${f.label} must be a number`
    }
    return ''
  }

  const validateCustom = (def: CustomFieldDef): string => {
    const v = customValues[def.apiName]
    const required = def.validationRules?.required === true
    const empty = v === undefined || v === null || v === '' ||
      (Array.isArray(v) && v.length === 0)
    if (required && empty) return `${def.label} is required`
    return ''
  }

  const focusFirstError = (keys: string[], custom: boolean) => {
    for (const k of keys) {
      const el = fieldRefs.current.get(custom ? `__c_${k}` : k)
      if (el) { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
    }
  }

  const save = async () => {
    if (saving) return

    // Validate standard fields
    const errs: Record<string, string> = {}
    let firstStd: string | null = null
    for (const f of stdFields) {
      if (fieldReadOnly(f.key)) continue // stripped server-side — never block the save
      const msg = validateStandard(f)
      if (msg) { errs[f.key] = msg; if (!firstStd) firstStd = f.key }
    }
    // Validate custom fields
    let firstCustom: string | null = null
    for (const def of customDefs ?? []) {
      const msg = validateCustom(def)
      if (msg) { errs[`__c_${def.apiName}`] = msg; if (!firstCustom) firstCustom = def.apiName }
    }
    if (Object.keys(errs).filter((k) => errs[k]).length > 0) {
      setErrors(errs)
      toast.error('Please fix the highlighted fields')
      focusFirstError(firstStd ? [firstStd] : [], false)
      if (!firstStd && firstCustom) focusFirstError([firstCustom], true)
      return
    }

    // Build payload: omit empty optional numbers/dates so we never send NaN/''
    // (hidden fields were already removed; read-only fields are skipped since
    // the server strips them anyway).
    const payload: Record<string, unknown> = {}
    for (const f of stdFields) {
      if (fieldReadOnly(f.key)) continue
      const raw = values[f.key]
      const isNumber = f.type === 'number' || f.type === 'currency'
      const str = raw === null || raw === undefined ? '' : String(raw)
      if (isNumber || f.type === 'date') {
        if (str.trim() !== '') payload[f.key] = isNumber ? Number(str) : str
        else if (f.required) return // unreachable (validated above) — safety net
      } else if (f.type === 'checkbox') {
        payload[f.key] = Boolean(raw)
      } else if (f.type === 'multiselect') {
        payload[f.key] = Array.isArray(raw) ? raw : []
      } else if (f.type === 'select' && f.clearable && str === '') {
        payload[f.key] = null
      } else {
        payload[f.key] = raw ?? ''
      }
    }

    // Custom values: only touched keys. '' on a touched key clears (null).
    if (module && touchedCustom.current.size > 0) {
      const cf: Record<string, unknown> = {}
      for (const apiName of touchedCustom.current) {
        const v = customValues[apiName]
        cf[apiName] = v === '' || v === undefined ? null : v
      }
      payload.customFields = cf
    }

    setSaving(true)
    try {
      await onSave(payload)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const saveRef = React.useRef(save)
  saveRef.current = save

  // Cmd/Ctrl+S to save
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // ----- render helpers -----

  const renderInput = (f: FieldDef, ro = false) => {
    const value = values[f.key]
    const strValue = value === null || value === undefined ? '' : String(value)
    const errMsg = errors[f.key]
    const inputType = f.type === 'number' || f.type === 'currency'
      ? 'number'
      : f.type === 'date' ? 'date'
      : f.type === 'email' ? 'email'
      : f.type === 'phone' ? 'tel'
      : f.type === 'url' ? 'url'
      : 'text'
    // Long emails must never push the form layout: clip with an ellipsis at
    // rest; the native input still scrolls horizontally once focused so the
    // full address stays editable.
    const emailOverflow = inputType === 'email'
      ? 'overflow-hidden [text-overflow:ellipsis] focus:[text-overflow:clip]'
      : undefined
    const common = {
      id: f.key,
      type: inputType,
      value: strValue,
      placeholder: f.placeholder ?? (f.type === 'url' ? 'https://' : undefined),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        set(f.key, e.target.value),
      disabled: ro || undefined,
      'aria-disabled': ro || undefined,
      'aria-invalid': !!errMsg || undefined,
      className: [errMsg ? 'border-destructive focus-visible:ring-destructive' : '', emailOverflow]
        .filter(Boolean).join(' ') || undefined,
    }
    return (
      <div className="space-y-1">
        {f.type === 'textarea' ? (
          <Textarea
            id={f.key} value={strValue} rows={4}
            placeholder={f.placeholder}
            onChange={(e) => set(f.key, e.target.value)}
            disabled={ro || undefined}
            aria-disabled={ro || undefined}
            aria-invalid={!!errMsg || undefined}
            className={errMsg ? 'border-destructive focus-visible:ring-destructive' : undefined}
            ref={(el) => { if (el) fieldRefs.current.set(f.key, el); else fieldRefs.current.delete(f.key) }}
          />
        ) : (
          <Input
            {...common}
            step={f.type === 'currency' ? '0.01' : undefined}
            ref={(el) => { if (el) fieldRefs.current.set(f.key, el); else fieldRefs.current.delete(f.key) }}
          />
        )}
        {errMsg
          ? <p className="text-xs text-destructive" role="alert">{errMsg}</p>
          : <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {ro && <Lock className="size-3" aria-hidden />}
              {ro ? 'Read only for your role' : f.hint}
            </p>}
      </div>
    )
  }

  const renderSelect = (f: FieldDef, ro = false) => {
    const value = String(values[f.key] ?? '')
    const errMsg = errors[f.key]
    return (
      <div className="space-y-1">
        <Select
          value={value || '__empty__'}
          onValueChange={(v) => set(f.key, v === '__empty__' ? '' : v)}
          disabled={ro}
        >
          <SelectTrigger
            id={f.key}
            aria-disabled={ro || undefined}
            aria-invalid={!!errMsg || undefined}
            className={errMsg ? 'border-destructive' : undefined}
          >
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(f.clearable || !f.required) && (
              <SelectItem value="__empty__">— None —</SelectItem>
            )}
            {f.options?.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errMsg
          ? <p className="text-xs text-destructive" role="alert">{errMsg}</p>
          : <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {ro && <Lock className="size-3" aria-hidden />}
              {ro ? 'Read only for your role' : f.hint}
            </p>}
      </div>
    )
  }

  /** Multi-select: chip-toggle buttons; value is a string[] (serialized by the owning view). */
  const renderMultiselect = (f: FieldDef, ro = false) => {
    const arr = Array.isArray(values[f.key]) ? (values[f.key] as string[]) : []
    const errMsg = errors[f.key]
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={f.label}>
          {(f.options ?? []).map((o) => {
            const active = arr.includes(o.value)
            return (
              <button
                key={o.value} type="button" aria-pressed={active} disabled={ro}
                onClick={() => set(f.key, active ? arr.filter((x) => x !== o.value) : [...arr, o.value])}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  active ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {o.label}
              </button>
            )
          })}
        </div>
        {errMsg
          ? <p className="text-xs text-destructive" role="alert">{errMsg}</p>
          : <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {ro && <Lock className="size-3" aria-hidden />}
              {ro ? 'Read only for your role' : f.hint}
            </p>}
      </div>
    )
  }

  const renderCheckbox = (f: FieldDef, ro = false) => {
    const checked = Boolean(values[f.key])
    return (
      <label
        htmlFor={f.key}
        className={`flex h-9 items-center gap-2.5 rounded-md border px-3 transition-colors ${ro ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-muted/50'}`}
      >
        <Switch
          id={f.key}
          checked={checked}
          onCheckedChange={(v) => set(f.key, v)}
          disabled={ro}
        />
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {ro && <Lock className="size-3" aria-hidden />}
          {ro ? 'Read only for your role' : (f.hint ?? (checked ? 'Yes' : 'No'))}
        </span>
      </label>
    )
  }

  const renderField = (f: FieldDef, ro = false) => {
    if (f.type === 'select') return renderSelect(f, ro)
    if (f.type === 'checkbox') return renderCheckbox(f, ro)
    if (f.type === 'multiselect') return renderMultiselect(f, ro)
    return renderInput(f, ro)
  }

  // ----- custom field renderers -----

  const renderCustomField = (def: CustomFieldDef) => {
    const value = customValues[def.apiName]
    const errMsg = errors[`__c_${def.apiName}`]
    const options = Array.isArray(def.fieldOptions?.options)
      ? (def.fieldOptions.options as string[])
      : []
    const id = `__c_${def.apiName}`
    const invalidCls = errMsg ? 'border-destructive focus-visible:ring-destructive' : undefined

    let control: React.ReactNode = null
    switch (def.fieldType) {
      case 'number': case 'currency': case 'percent': case 'decimal': case 'rating': {
        control = def.fieldType === 'rating' ? (
          <Select value={value === undefined || value === null || value === '' ? '__empty__' : String(value)}
            onValueChange={(v) => setCustom(def.apiName, v === '__empty__' ? '' : Number(v))}>
            <SelectTrigger id={id} className={invalidCls}><SelectValue placeholder="Select rating…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty__">— None —</SelectItem>
              {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{'★'.repeat(n)}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Input id={id} type="number" step={def.fieldType === 'currency' ? '0.01' : undefined}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => setCustom(def.apiName, e.target.value)}
            className={invalidCls} aria-invalid={!!errMsg || undefined}
            ref={(el) => { if (el) fieldRefs.current.set(id, el); else fieldRefs.current.delete(id) }} />
        )
        break
      }
      case 'date': case 'datetime': case 'time': {
        control = (
          <Input id={id}
            type={def.fieldType === 'datetime' ? 'datetime-local' : def.fieldType === 'time' ? 'time' : 'date'}
            value={value === null || value === undefined ? '' : String(value).slice(0, def.fieldType === 'datetime' ? 16 : def.fieldType === 'date' ? 10 : 5)}
            onChange={(e) => setCustom(def.apiName, e.target.value)}
            className={invalidCls} aria-invalid={!!errMsg || undefined}
            ref={(el) => { if (el) fieldRefs.current.set(id, el); else fieldRefs.current.delete(id) }} />
        )
        break
      }
      case 'picklist': {
        control = (
          <Select value={value ? String(value) : '__empty__'}
            onValueChange={(v) => setCustom(def.apiName, v === '__empty__' ? '' : v)}>
            <SelectTrigger id={id} className={invalidCls}><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty__">— None —</SelectItem>
              {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        )
        break
      }
      case 'multi_picklist': {
        const arr = Array.isArray(value) ? (value as string[]) : []
        control = options.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={def.label}>
            {options.map((o) => {
              const active = arr.includes(o)
              return (
                <button
                  key={o} type="button" aria-pressed={active}
                  onClick={() => setCustom(def.apiName, active ? arr.filter((x) => x !== o) : [...arr, o])}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    active ? 'border-primary bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {o}
                </button>
              )
            })}
          </div>
        ) : <p className="text-xs text-muted-foreground">No options configured for this field.</p>
        break
      }
      case 'checkbox': {
        control = (
          <label htmlFor={id} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md border px-3 hover:bg-muted/50">
            <Switch id={id} checked={Boolean(value)} onCheckedChange={(v) => setCustom(def.apiName, v)} />
            <span className="text-sm text-muted-foreground">{value ? 'Yes' : 'No'}</span>
          </label>
        )
        break
      }
      case 'long_text': case 'rich_text': case 'address': {
        control = (
          <Textarea id={id} rows={3}
            value={value === null || value === undefined ? '' : displayCustomValue(value)}
            onChange={(e) => setCustom(def.apiName, e.target.value)}
            className={invalidCls} aria-invalid={!!errMsg || undefined}
            ref={(el) => { if (el) fieldRefs.current.set(id, el); else fieldRefs.current.delete(id) }} />
        )
        break
      }
      default: {
        // text, email, phone, url, time
        control = (
          <Input id={id}
            type={def.fieldType === 'email' ? 'email' : def.fieldType === 'phone' ? 'tel' : def.fieldType === 'url' ? 'url' : 'text'}
            value={value === null || value === undefined ? '' : displayCustomValue(value)}
            onChange={(e) => setCustom(def.apiName, e.target.value)}
            className={[
              invalidCls ?? '',
              // Same long-email safety net as the standard fields above.
              def.fieldType === 'email' ? 'overflow-hidden [text-overflow:ellipsis] focus:[text-overflow:clip]' : '',
            ].filter(Boolean).join(' ') || undefined}
            aria-invalid={!!errMsg || undefined}
            ref={(el) => { if (el) fieldRefs.current.set(id, el); else fieldRefs.current.delete(id) }} />
        )
      }
    }

    return (
      <div key={def.apiName} className={`space-y-1 ${def.fieldType === 'long_text' || def.fieldType === 'rich_text' || def.fieldType === 'address' ? 'col-span-full' : ''}`}>
        <Label htmlFor={id} className="flex items-center gap-1">
          {def.label}
          {def.validationRules?.required === true && <span className="text-destructive">*</span>}
          <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[9px] uppercase tracking-wide text-muted-foreground">
            {def.fieldType.replace('_', ' ')}
          </Badge>
        </Label>
        {control}
        {errMsg
          ? <p className="text-xs text-destructive" role="alert">{errMsg}</p>
          : null}
      </div>
    )
  }

  // ----- sectioning -----

  const sections = React.useMemo(() => {
    const map = new Map<string, FieldDef[]>()
    for (const f of stdFields) {
      const s = sectionOf(f)
      if (!map.has(s)) map.set(s, [])
      map.get(s)!.push(f)
    }
    return [...map.entries()]
  }, [stdFields])

  const customList = customDefs ?? []

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {sections.map(([section, sFields], idx) => (
            <section key={section} aria-label={section} className={idx > 0 ? 'mt-6' : ''}>
              <div className="mb-3.5 flex items-center gap-3">
                <h3 className="text-sm font-semibold tracking-tight">{section}</h3>
                <Separator className="flex-1" />
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                {sFields.map((f) => {
                  const ro = fieldReadOnly(f.key)
                  return (
                    <div key={f.key} className={`space-y-1.5 ${f.full || f.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
                      <Label htmlFor={f.key} className="flex items-center gap-1">
                        {f.label}
                        {f.required && <span className="text-destructive">*</span>}
                        {ro && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                            <Lock className="size-3" aria-hidden /> Read only
                          </span>
                        )}
                      </Label>
                      {renderField(f, ro)}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}

          {module && (
            <section aria-label="Custom fields" className="mt-6">
              <div className="mb-3.5 flex items-center gap-3">
                <h3 className="text-sm font-semibold tracking-tight">Custom Fields</h3>
                <Separator className="flex-1" />
                <Button
                  variant="outline" size="sm" className="h-7 text-xs"
                  onClick={() => { setAddFieldErrors({}); setAddFieldOpen(true) }}
                  title="Add a new field to this form"
                >
                  <Plus className="mr-1 size-3.5" /> Add field
                </Button>
              </div>
              {!customDefs ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-9 w-full" />
                    </div>
                  ))}
                </div>
              ) : customList.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  No custom fields yet — click “Add field” to create one (free text, dropdown, number, date…). It appears here instantly for every member.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                  {customList.map(renderCustomField)}
                </div>
              )}
              {/* Surface unsupported custom types transparently instead of hiding them */}
              {(customDefs ?? []).length !== customList.length && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Skipping: {([...(customDefs ?? [])].filter((d) => !SUPPORTED_CUSTOM_TYPES.has(d.fieldType)))
                    .map((d) => `${d.label} (${CUSTOM_UNSUPPORTED_NOTE[d.fieldType] ?? d.fieldType})`)
                    .join(' · ')}
                </p>
              )}
            </section>
          )}
        </div>

        <SheetFooter className="flex-row items-center justify-between gap-2 border-t bg-background px-5 py-3">
          <p className="hidden text-xs text-muted-foreground sm:block">
            <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">Ctrl</kbd>
            {' + '}
            <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">S</kbd>
            {' '}to save
          </p>
          <div className="flex flex-1 items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Save className="mr-1.5 size-4" />}
              {saving ? 'Saving…' : 'Save record'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    {/* Inline "Add field" dialog — creates a custom field for this module
        (free text, dropdown with options, number, date…) without leaving the form. */}
    <Dialog open={addFieldOpen} onOpenChange={setAddFieldOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add field</DialogTitle>
          <DialogDescription>
            Create a custom field for this module — it appears in this form instantly for every member.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="__af_label">Label</Label>
            <Input
              id="__af_label" value={addField.label}
              placeholder="e.g. Preferred city"
              onChange={(e) => setAddField({ ...addField, label: e.target.value })}
              aria-invalid={!!addFieldErrors.label || undefined}
              className={addFieldErrors.label ? 'border-destructive' : undefined}
            />
            {addFieldErrors.label && <p className="text-xs text-destructive" role="alert">{addFieldErrors.label}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="__af_type">Field type</Label>
            <Select value={addField.fieldType} onValueChange={(v) => setAddField({ ...addField, fieldType: v })}>
              <SelectTrigger id="__af_type"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-60">
                {ADD_FIELD_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {ADD_FIELD_OPTIONS_TYPES.has(addField.fieldType) && (
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="__af_options">Dropdown options (one per line)</Label>
              <Textarea
                id="__af_options" rows={4} value={addField.optionsText}
                placeholder={'Low\nMedium\nHigh'}
                onChange={(e) => setAddField({ ...addField, optionsText: e.target.value })}
                aria-invalid={!!addFieldErrors.optionsText || undefined}
                className={addFieldErrors.optionsText ? 'border-destructive' : undefined}
              />
              {addFieldErrors.optionsText && <p className="text-xs text-destructive" role="alert">{addFieldErrors.optionsText}</p>}
            </div>
          )}
          <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Required</p>
              <p className="text-xs text-muted-foreground">Members must fill this field before saving</p>
            </div>
            <Switch
              checked={addField.required} onCheckedChange={(v) => setAddField({ ...addField, required: v })}
              aria-label="Required field"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddFieldOpen(false)} disabled={addFieldSaving}>Cancel</Button>
          <Button onClick={submitAddField} disabled={addFieldSaving}>
            {addFieldSaving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {addFieldSaving ? 'Creating…' : 'Create field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
