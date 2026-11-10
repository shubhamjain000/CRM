'use client'

/**
 * Shared UI for the Unstop CSM cadence: step badge, due label and the
 * cadence card shown on contact detail pages.
 */

import * as React from 'react'
import { CalendarClock, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CSM_STEPS, CSM_TONE_CLASSES, csmDueInfo, csmStepMeta } from '@/lib/csm'
import { toast } from 'sonner'

export function CsmStepBadge({ step, className = '' }: { step: string; className?: string }) {
  const meta = csmStepMeta(step)
  const tone = CSM_TONE_CLASSES[meta.tone]
  return (
    <Badge variant="outline" className={`w-fit gap-1.5 whitespace-nowrap text-[11px] font-medium ${tone.badge} ${className}`}>
      <span className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
      {meta.value}
    </Badge>
  )
}

export function CsmDueLabel({ dueAt, className = '' }: { dueAt: string | Date | null | undefined; className?: string }) {
  const info = csmDueInfo(dueAt)
  if (!info) return null
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${info.className} ${className}`}>
      <CalendarClock className="size-3" aria-hidden />
      {info.label}
    </span>
  )
}

/** Badge + due date stacked — table cell friendly. */
export function CsmStepCell({ step, dueAt }: { step: string; dueAt?: string | null }) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <CsmStepBadge step={step} />
      <CsmDueLabel dueAt={dueAt} />
    </div>
  )
}

const GROUP_ORDER: CsmGroup[] = ['No cadence', 'Warm-up', 'Follow-up', 'Wrap-up']
type CsmGroup = (typeof CSM_STEPS)[number]['group']

interface CadenceCardProps {
  step: string
  dueAt?: string | null
  changedAt?: string | null
  /** Persists the new step (API call). Errors must throw — the card surfaces them. */
  onChange: (step: string) => Promise<void>
}

export function CsmCadenceCard({ step, dueAt, changedAt, onChange }: CadenceCardProps) {
  const [value, setValue] = React.useState(step)
  const [saving, setSaving] = React.useState(false)
  const meta = csmStepMeta(value)

  React.useEffect(() => setValue(step), [step])

  const change = async (next: string) => {
    if (next === value) return
    const previous = value
    setValue(next)
    setSaving(true)
    try {
      await onChange(next)
    } catch (e) {
      setValue(previous)
      toast.error(e instanceof Error ? e.message : 'Could not update the cadence')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-semibold">Sales cadence</CardTitle>
        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">CSM loop</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CsmStepBadge step={value} />
          <CsmDueLabel dueAt={dueAt} />
          {saving && <RefreshCw className="size-3 animate-spin text-muted-foreground" aria-label="Saving" />}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="csm-step-select">
            Next step
          </label>
          <Select value={value} onValueChange={change} disabled={saving}>
            <SelectTrigger id="csm-step-select" aria-label="Set CSM next step" className="h-9">
              <SelectValue placeholder="Choose the next step" />
            </SelectTrigger>
            <SelectContent>
              {GROUP_ORDER.map((group) => (
                <SelectGroup key={group}>
                  <SelectLabel className="text-xs text-muted-foreground">{group}</SelectLabel>
                  {CSM_STEPS.filter((s) => s.group === group).map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      <span className="flex items-center gap-2">
                        <span className={`inline-block size-2 rounded-full ${CSM_TONE_CLASSES[s.tone].dot}`} aria-hidden />
                        {s.value}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {meta.hint}. The follow-up due date is set automatically and a follow-up task is created —
          BI picks the change up instantly.
        </p>
        {changedAt && (
          <p className="text-[11px] text-muted-foreground">
            Last updated {new Date(changedAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
