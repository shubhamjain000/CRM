/**
 * Unstop Sales — CSM (Customer Success Motion) cadence.
 *
 * The "next step" is the single field reps live in: it says what the next
 * touchpoint with a contact is and when it is due. Every step carries an
 * offset in days; the follow-up due date is set server-side the moment the
 * step changes (set date + offset, end of that day) and a follow-up task is
 * created automatically. BI reads the same field, so reporting needs zero
 * extra configuration.
 *
 * This module is pure TypeScript — safe to import from client components,
 * server routes and tests alike. Keep it free of `db` / auth imports.
 */

export type CsmTone =
  | 'slate'
  | 'amber'
  | 'teal'
  | 'violet'
  | 'orange'
  | 'rose'
  | 'stone'
  | 'emerald'

export interface CsmStepMeta {
  /** Canonical value stored on the Contact record. */
  value: string
  /** Days until the follow-up is due (from the day the step is set). null = no follow-up. */
  days: number | null
  tone: CsmTone
  group: 'No cadence' | 'Warm-up' | 'Follow-up' | 'Wrap-up'
  hint: string
  /** Terminal steps close the loop (no due date, excluded from active counts). */
  terminal: boolean
}

export const CSM_STEPS: CsmStepMeta[] = [
  { value: 'None',              days: null, tone: 'slate',   group: 'No cadence', hint: 'Not in an active follow-up loop', terminal: false },
  { value: 'Day 0',             days: 0,    tone: 'amber',   group: 'Warm-up',    hint: 'First touch — close it out today', terminal: false },
  { value: 'Day 0 reconnect',   days: 0,    tone: 'amber',   group: 'Warm-up',    hint: 'Reconnect before end of day', terminal: false },
  { value: 'Day 1 Reconnect',   days: 1,    tone: 'teal',    group: 'Warm-up',    hint: 'Reconnect tomorrow', terminal: false },
  { value: 'Day 3 Call',        days: 3,    tone: 'violet',  group: 'Follow-up',  hint: 'Discovery call in 3 days', terminal: false },
  { value: 'Day 3 Reconnect',   days: 3,    tone: 'violet',  group: 'Follow-up',  hint: 'Reconnect in 3 days', terminal: false },
  { value: 'Day 7',             days: 7,    tone: 'orange',  group: 'Follow-up',  hint: 'Week-1 check-in', terminal: false },
  { value: 'Day 14 Call',       days: 14,   tone: 'rose',    group: 'Follow-up',  hint: 'Fortnight call', terminal: false },
  { value: 'Old Lead',          days: null, tone: 'stone',   group: 'Wrap-up',    hint: 'Parked — revive when a new cycle opens', terminal: true },
  { value: 'CSM Loop complete', days: null, tone: 'emerald', group: 'Wrap-up',    hint: 'Cadence finished — hand off or expand', terminal: true },
]

export const CSM_VALUES: readonly string[] = CSM_STEPS.map((s) => s.value)

const CSM_BY_VALUE: Record<string, CsmStepMeta> = Object.fromEntries(
  CSM_STEPS.map((s) => [s.value, s]),
)

const NONE_STEP = CSM_BY_VALUE['None']

export function csmStepMeta(value: string | null | undefined): CsmStepMeta {
  return (value && CSM_BY_VALUE[value]) || NONE_STEP
}

/** Follow-up due date for a step: `from` + offset days, end of that local day. */
export function csmDueDate(value: string, from: Date = new Date()): Date | null {
  const meta = csmStepMeta(value)
  if (meta.days === null) return null
  const due = new Date(from)
  due.setDate(due.getDate() + meta.days)
  due.setHours(23, 59, 59, 999)
  return due
}

/** Static Tailwind classes per tone (kept literal so the JIT can see them). */
export const CSM_TONE_CLASSES: Record<CsmTone, { badge: string; dot: string; bar: string; text: string }> = {
  slate: {
    badge: 'border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300',
    dot: 'bg-slate-400', bar: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-300',
  },
  amber: {
    badge: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500', bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400',
  },
  teal: {
    badge: 'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400',
    dot: 'bg-teal-500', bar: 'bg-teal-500', text: 'text-teal-700 dark:text-teal-400',
  },
  violet: {
    badge: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400',
    dot: 'bg-violet-500', bar: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-400',
  },
  orange: {
    badge: 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400',
    dot: 'bg-orange-500', bar: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-400',
  },
  rose: {
    badge: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400',
    dot: 'bg-rose-500', bar: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400',
  },
  stone: {
    badge: 'border-stone-400/40 bg-stone-500/10 text-stone-600 dark:text-stone-300',
    dot: 'bg-stone-400', bar: 'bg-stone-400', text: 'text-stone-600 dark:text-stone-300',
  },
  emerald: {
    badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500', bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400',
  },
}

export interface CsmDueInfo {
  /** overdue | today | tomorrow | upcoming */
  state: 'overdue' | 'today' | 'tomorrow' | 'upcoming'
  /** Short human label, e.g. "Overdue 2d", "Due today", "Due Fri, 24 Jan". */
  label: string
  /** Tailwind text class for the label. */
  className: string
}

const DAY = 86_400_000

function startOfLocalDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

/** Human-facing due metadata for a follow-up date. */
export function csmDueInfo(dueAt: string | Date | null | undefined): CsmDueInfo | null {
  if (!dueAt) return null
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return null
  const today = startOfLocalDay(new Date())
  const dueDay = startOfLocalDay(due)
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / DAY)
  const dateLabel = due.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  if (diffDays < 0) {
    return {
      state: 'overdue',
      label: diffDays === -1 ? 'Overdue 1d' : `Overdue ${Math.abs(diffDays)}d`,
      className: 'text-rose-600 dark:text-rose-400',
    }
  }
  if (diffDays === 0) return { state: 'today', label: 'Due today', className: 'text-amber-600 dark:text-amber-400' }
  if (diffDays === 1) return { state: 'tomorrow', label: 'Due tomorrow', className: 'text-teal-600 dark:text-teal-400' }
  return { state: 'upcoming', label: `Due ${dateLabel}`, className: 'text-muted-foreground' }
}

/** Title prefix used for follow-up tasks created from the cadence. */
export const CSM_TASK_PREFIX = '[CSM]'

export function csmTaskTitle(step: string, contactName: string): string {
  return `${CSM_TASK_PREFIX} ${step} — ${contactName}`
}
