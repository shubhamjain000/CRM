/** Note kind metadata shared by the DetailView notes tab and anywhere notes render. */

export interface NoteKindMeta {
  label: string
  group: string
  class: string
  dot: string
}

export const NOTE_KIND_META: Record<string, NoteKindMeta> = {
  'general': {
    label: 'General note', group: 'General',
    class: 'border-border text-muted-foreground', dot: 'bg-muted-foreground',
  },
  'day-0': {
    label: 'Day 0 — Introduction', group: 'Touchpoint cadence',
    class: 'border-sky-500/40 text-sky-600 dark:text-sky-400', dot: 'bg-sky-500',
  },
  'day-1-reconnect': {
    label: 'Day 1 — Reconnect', group: 'Touchpoint cadence',
    class: 'border-cyan-500/40 text-cyan-600 dark:text-cyan-400', dot: 'bg-cyan-500',
  },
  'day-3-followup': {
    label: 'Day 3 — Follow-up', group: 'Touchpoint cadence',
    class: 'border-teal-500/40 text-teal-600 dark:text-teal-400', dot: 'bg-teal-500',
  },
  'week-1-checkin': {
    label: 'Week 1 — Check-in', group: 'Touchpoint cadence',
    class: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500',
  },
  'week-2-update': {
    label: 'Week 2 — Update', group: 'Touchpoint cadence',
    class: 'border-green-500/40 text-green-600 dark:text-green-400', dot: 'bg-green-500',
  },
  'month-1-review': {
    label: 'Month 1 — Review', group: 'Touchpoint cadence',
    class: 'border-lime-500/40 text-lime-600 dark:text-lime-400', dot: 'bg-lime-500',
  },
  'call-outcome': {
    label: 'Call outcome', group: 'Interactions',
    class: 'border-violet-500/40 text-violet-600 dark:text-violet-400', dot: 'bg-violet-500',
  },
  'meeting': {
    label: 'Meeting notes', group: 'Interactions',
    class: 'border-purple-500/40 text-purple-600 dark:text-purple-400', dot: 'bg-purple-500',
  },
  'email': {
    label: 'Email / correspondence', group: 'Interactions',
    class: 'border-fuchsia-500/40 text-fuchsia-600 dark:text-fuchsia-400', dot: 'bg-fuchsia-500',
  },
  'quote-sent': {
    label: 'Quote / proposal sent', group: 'Commercial',
    class: 'border-amber-500/40 text-amber-600 dark:text-amber-400', dot: 'bg-amber-500',
  },
  'payment-reminder': {
    label: 'Payment reminder', group: 'Commercial',
    class: 'border-orange-500/40 text-orange-600 dark:text-orange-400', dot: 'bg-orange-500',
  },
  'objection': {
    label: 'Objection handling', group: 'Commercial',
    class: 'border-rose-500/40 text-rose-600 dark:text-rose-400', dot: 'bg-rose-500',
  },
  'next-steps': {
    label: 'Next steps', group: 'Commercial',
    class: 'border-yellow-500/40 text-yellow-600 dark:text-yellow-400', dot: 'bg-yellow-500',
  },
}

export const NOTE_KIND_ORDER = [
  'general',
  'day-0', 'day-1-reconnect', 'day-3-followup', 'week-1-checkin', 'week-2-update', 'month-1-review',
  'call-outcome', 'meeting', 'email',
  'quote-sent', 'payment-reminder', 'objection', 'next-steps',
]

export function noteKindMeta(kind: string): NoteKindMeta {
  return NOTE_KIND_META[kind] ?? NOTE_KIND_META['general']
}
