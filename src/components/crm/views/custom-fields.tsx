'use client'

import * as React from 'react'
import { Plus, Trash2, Settings2, EyeOff } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

const MODULES = [
  { value: 'lead', label: 'Lead' },
  { value: 'contact', label: 'Contact' },
  { value: 'account', label: 'Account' },
  { value: 'deal', label: 'Deal' },
]

const FIELD_TYPES = [
  'text', 'long_text', 'number', 'currency', 'percent', 'decimal',
  'date', 'datetime', 'time', 'email', 'phone', 'url', 'picklist', 'multi_picklist',
  'checkbox', 'rating', 'address',
]

const TYPES_WITH_OPTIONS = new Set(['picklist', 'multi_picklist'])

interface CustomField {
  id: string; module: string; label: string; apiName: string; fieldType: string
  fieldOptions: Record<string, unknown>
  validationRules: Record<string, unknown>
  defaultValue: string | null; isActive: boolean; createdAt: string
}

const EMPTY_FORM = {
  module: 'lead', label: '', apiName: '', fieldType: 'text',
  defaultValue: '', optionsText: '', required: false,
}

export function CustomFieldsView() {
  const [fields, setFields] = React.useState<CustomField[] | null>(null)
  const [open, setOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [moduleFilter, setModuleFilter] = React.useState('lead')
  const [form, setForm] = React.useState({ ...EMPTY_FORM })
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/crm/custom-fields?module=${moduleFilter}`, { cache: 'no-store' })
    const data = await res.json()
    setFields(data.fields ?? [])
  }, [moduleFilter])

  React.useEffect(() => { load() }, [load])

  const create = async () => {
    const errs: Record<string, string> = {}
    if (!form.label.trim()) errs.label = 'Label is required'
    if (!form.apiName.trim()) errs.apiName = 'API name is required'
    if (TYPES_WITH_OPTIONS.has(form.fieldType)) {
      const options = form.optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
      if (options.length === 0) errs.optionsText = 'Add at least one option (one per line)'
    }
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setErrors({})

    const body: Record<string, unknown> = {
      module: form.module,
      label: form.label.trim(),
      apiName: form.apiName.trim(),
      fieldType: form.fieldType,
      defaultValue: form.defaultValue.trim() || null,
      validationRules: form.required ? { required: true } : {},
    }
    if (TYPES_WITH_OPTIONS.has(form.fieldType)) {
      body.fieldOptions = {
        options: form.optionsText.split('\n').map((s) => s.trim()).filter(Boolean),
      }
    }

    setCreating(true)
    try {
      const res = await fetch('/api/crm/custom-fields', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to create field'); return }
      toast.success(`Custom field "${form.label.trim()}" created — it now appears in every ${form.module} form`)
      setOpen(false)
      setForm({ ...EMPTY_FORM, module: moduleFilter })
      load()
    } catch {
      toast.error('Failed to create field')
    } finally {
      setCreating(false)
    }
  }

  const deactivate = async (f: CustomField) => {
    try {
      const res = await fetch(`/api/crm/custom-fields/${f.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed')
      toast.success(`"${f.label}" deactivated — existing values are kept`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to deactivate field')
    }
  }

  const filtered = fields ?? []
  const needsOptions = TYPES_WITH_OPTIONS.has(form.fieldType)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Custom Fields</h1>
          <p className="text-muted-foreground">Add whatever fields you need — they appear instantly in every record form</p>
        </div>
        <Button onClick={() => { setForm({ ...EMPTY_FORM, module: moduleFilter }); setErrors({}); setOpen(true) }}>
          <Plus className="mr-1.5 size-4" /> Add field
        </Button>
      </div>

      <div className="flex gap-2">
        {MODULES.map((m) => (
          <Button
            key={m.value}
            variant={moduleFilter === m.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setModuleFilter(m.value)}
          >
            {m.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="size-4" /> {MODULES.find((m) => m.value === moduleFilter)?.label} fields
          </CardTitle>
          <CardDescription>{filtered.length} custom field{filtered.length !== 1 ? 's' : ''}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!fields ? (
            <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No custom fields yet. Click “Add field” to extend this module.
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((f) => {
                const options = Array.isArray(f.fieldOptions?.options) ? (f.fieldOptions.options as string[]) : []
                return (
                  <li key={f.id} className="flex items-center gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{f.label}</p>
                        <Badge variant="outline" className="font-mono text-[10px]">{f.fieldType.replace('_', ' ')}</Badge>
                        {f.validationRules?.required === true && <Badge variant="secondary" className="text-[10px]">required</Badge>}
                        {!f.isActive && <Badge variant="secondary" className="text-[10px]">inactive</Badge>}
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">{f.apiName}</p>
                      {options.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {options.map((o) => (
                            <span key={o} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{o}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {f.defaultValue && <span className="hidden text-xs text-muted-foreground sm:block">default: {f.defaultValue}</span>}
                    <Button
                      variant="ghost" size="icon" className="size-8 shrink-0"
                      title="Deactivate field" aria-label={`Deactivate ${f.label}`}
                      onClick={() => deactivate(f)}
                    >
                      <EyeOff className="size-4" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New custom field</DialogTitle>
            <DialogDescription>Available on all {form.module} records instantly.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Priority Score" aria-invalid={!!errors.label || undefined} className={errors.label ? 'border-destructive' : undefined} />
              {errors.label && <p className="text-xs text-destructive" role="alert">{errors.label}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>API name</Label>
              <Input value={form.apiName} onChange={(e) => setForm({ ...form, apiName: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]/, '').slice(0, 64) })} placeholder="priority_score" aria-invalid={!!errors.apiName || undefined} className={errors.apiName ? 'border-destructive' : undefined} />
              {errors.apiName && <p className="text-xs text-destructive" role="alert">{errors.apiName}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Field type</Label>
              <Select value={form.fieldType} onValueChange={(v) => setForm({ ...form, fieldType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Default value (optional)</Label>
              <Input value={form.defaultValue} onChange={(e) => setForm({ ...form, defaultValue: e.target.value })} />
            </div>
            {needsOptions && (
              <div className="col-span-2 space-y-1.5">
                <Label>Options (one per line)</Label>
                <Textarea
                  rows={4}
                  value={form.optionsText}
                  onChange={(e) => setForm({ ...form, optionsText: e.target.value })}
                  placeholder={'Low\nMedium\nHigh'}
                  aria-invalid={!!errors.optionsText || undefined}
                  className={errors.optionsText ? 'border-destructive' : undefined}
                />
                {errors.optionsText && <p className="text-xs text-destructive" role="alert">{errors.optionsText}</p>}
              </div>
            )}
            <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Required</p>
                <p className="text-xs text-muted-foreground">Users must fill this field when saving a record</p>
              </div>
              <Switch checked={form.required} onCheckedChange={(v) => setForm({ ...form, required: v })} aria-label="Required field" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={creating}>
              {creating ? 'Creating…' : 'Create field'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
