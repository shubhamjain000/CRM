'use client'

/**
 * Shared client helpers for the notification surfaces (bell + mobile banner).
 * Keeps the verb→group map and the targetModule→ViewKey deep-link map in ONE
 * place so both surfaces behave identically.
 */

export interface NotificationLike {
  id: string
  verb: string
  targetModule?: string | null
  targetId?: string | null
  targetName?: string | null
  data?: unknown
  readAt?: string | null
  createdAt: string
}

/** Extract the human message out of the notification payload (data JSON). */
export function notificationMessage(n: NotificationLike): string | null {
  const raw = (n as { data?: unknown }).data ?? (n as { message?: unknown }).message
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as { message?: unknown }
      if (typeof parsed?.message === 'string') return parsed.message
    } catch { /* not JSON */ }
    return raw
  }
  if (raw && typeof raw === 'object') {
    const m = (raw as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  // Realtime payloads carry `message` at the top level.
  const top = (n as { message?: unknown }).message
  return typeof top === 'string' ? top : null
}

export type NotificationGroup = 'all' | 'mentions' | 'tasks' | 'messages' | 'system'

/**
 * verb → filter group. Verified against every verb written in DB code:
 *   mentioned, commented (feed) · assignment_rule (crm) · call (telephony)
 *   approval_requested/approved/rejected (rule engine) · workflow_alert/
 *   workflow_notify/workflow_owner_notify (workflow) · invited (users)
 *   lead/deal/message/task_due (this task's new triggers)
 */
export function verbGroup(verb: string): Exclude<NotificationGroup, 'all'> {
  const v = (verb || '').toLowerCase()
  if (v.startsWith('mention') || v.startsWith('@')) return 'mentions'
  if (v.startsWith('task') || v.startsWith('todo')) return 'tasks'
  if (v.startsWith('message') || v.startsWith('whatsapp') || v.startsWith('email') || v.startsWith('sms')) return 'messages'
  return 'system'
}

/** Compact relative time used by the bell list and banner timestamps. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export const NOTIFICATION_GROUPS: { key: NotificationGroup; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mentions', label: 'Mentions' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'messages', label: 'Messages' },
  { key: 'system', label: 'System' },
]

/**
 * targetModule → shell ViewKey. Verified against the ViewKey union in
 * dashboard-shell.tsx ('leads'|'contacts'|'accounts'|'deals'|'tasks'|
 * 'calendar'|'inbox'). Unmapped modules stay put with a toast.
 */
const MODULE_TO_VIEW: Record<string, string> = {
  lead: 'leads', leads: 'leads',
  contact: 'contacts', contacts: 'contacts',
  account: 'accounts', accounts: 'accounts',
  deal: 'deals', deals: 'deals',
  task: 'tasks', tasks: 'tasks', todo: 'tasks',
  event: 'calendar', calendar: 'calendar',
  inbox: 'inbox', message: 'inbox', messages: 'inbox', whatsapp: 'inbox',
}

/** Result of resolving a notification's deep-link target. */
export interface NavigateTarget {
  view: string
  module?: string
  recordId?: string
}

export function resolveNotificationTarget(n: NotificationLike): NavigateTarget | null {
  const moduleName = (n.targetModule ?? '').toLowerCase()
  if (!moduleName) return null
  const view = MODULE_TO_VIEW[moduleName]
  if (!view) return null
  return { view, module: moduleName, recordId: n.targetId ?? undefined }
}

/**
 * Deep-link dispatch: for CRM/task records we stash the record id in
 * sessionStorage BEFORE navigating — the target view reads 'unstop:open-record'
 * on mount and opens the record's detail pane.
 */
export function dispatchNotificationNavigate(n: NotificationLike): boolean {
  const target = resolveNotificationTarget(n)
  if (!target) return false
  if (target.recordId && target.module) {
    try { sessionStorage.setItem('unstop:open-record', JSON.stringify({ module: target.module, id: target.recordId })) } catch { /* ignore */ }
  }
  window.dispatchEvent(new CustomEvent('unstop:navigate', { detail: target }))
  return true
}
