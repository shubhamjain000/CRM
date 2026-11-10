import { db } from '@/lib/db'
import { smtpConfigured, sendViaSmtp } from '@/lib/email/transport'
import { runDueDateBasedWorkflowsForAllOrgs } from '@/lib/crm/workflow-triggers'
import { syncDueGmailAccounts } from '@/lib/email/sync-scheduler'
import { syncDueIntegrations } from '@/lib/integrations/api-import'
import { createNotification } from '@/lib/realtime/handler'

/**
 * Background job runner — executes due ScheduledJob rows and system chores.
 *
 * Driven by src/instrumentation.ts (a 60s interval in the Next.js server
 * process). Previously `ScheduledJob.nextRunAt` was written on create and
 * NEVER read by any worker, which left trash auto-purge, scheduled emails,
 * and every scheduled automation silently dead.
 *
 * Supported job actionTypes:
 *   send_email            config: { to: string[], subject, html }
 *   webhook | http        config: { url, body? }   (https only, 10s timeout)
 *   trash_purge           config: { days?: number }  (default 30)
 *   process_queued_emails config: {}  (delivers queued outbound email via SMTP)
 *   (anything else is logged as skipped and rescheduled)
 */

const TRASH_RETENTION_DAYS = 30
const MAX_JOBS_PER_TICK = 20
const MAX_EMAILS_PER_TICK = 20

// Date-based workflow sweeps run at most once an hour (the day-window engine
// de-dupes per record, so this is purely a load guard).
const DATE_WORKFLOW_SWEEP_INTERVAL_MS = 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Minimal 5-field cron → next run (minute hour day-of-month month day-of-week)
// Supports: * , - / and plain numbers. Returns null when unparseable.
// ---------------------------------------------------------------------------

function fieldMatches(field: string, value: number): boolean {
  if (field === '*') return true
  for (const part of field.split(',')) {
    const [range, stepStr] = part.split('/')
    const step = stepStr ? Number(stepStr) : 1
    if (!Number.isFinite(step) || step < 1) continue
    let lo = 0
    let hi = Infinity
    if (range === '*') {
      lo = 0
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number)
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      lo = a; hi = b
    } else {
      const n = Number(range)
      if (!Number.isFinite(n)) continue
      lo = n; hi = stepStr ? Infinity : n
    }
    if (value >= lo && value <= hi && (value - lo) % step === 0) return true
  }
  return false
}

export function nextRunFromCron(expr: string, from: Date): Date | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minF, hourF, domF, monF, dowF] = parts
  // Bounded search: scan forward minute-by-minute, max 60 days.
  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  for (let i = 0; i < 60 * 24 * 60; i++) {
    const minute = cursor.getMinutes()
    const hour = cursor.getHours()
    const dom = cursor.getDate()
    const mon = cursor.getMonth() + 1
    const dow = cursor.getDay()
    const domOk = fieldMatches(domF, dom)
    const dowOk = fieldMatches(dowF, dow)
    // Standard cron semantics: when BOTH dom and dow are restricted, match either.
    const dayOk =
      (domF === '*' && dowF === '*') ||
      (domF !== '*' && dowF === '*' && domOk) ||
      (domF === '*' && dowF !== '*' && dowOk) ||
      (domF !== '*' && dowF !== '*' && (domOk || dowOk))
    if (
      fieldMatches(minF, minute) &&
      fieldMatches(hourF, hour) &&
      fieldMatches(monF, mon) &&
      dayOk
    ) {
      return new Date(cursor.getTime())
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return null
}

// ---------------------------------------------------------------------------
// System chores (run on every tick)
// ---------------------------------------------------------------------------

/** Hard-delete records soft-deleted more than TRASH_RETENTION_DAYS ago. */
async function purgeOldTrash(): Promise<number> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  let purged = 0
  for (const model of ['lead', 'contact', 'account', 'deal'] as const) {
    const delegate = db[model] as any
    const stale = await delegate.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true },
      take: 500,
    })
    if (stale.length === 0) continue
    const ids = stale.map((r: { id: string }) => r.id)
    await db.customFieldValue.deleteMany({ where: { recordId: { in: ids } } })
    const res = await delegate.deleteMany({ where: { id: { in: ids } } })
    purged += res.count
  }
  return purged
}

/**
 * Deliver queued outbound email when SMTP is configured. Scheduled messages
 * only go out once their scheduledAt has passed.
 */
async function deliverQueuedEmails(): Promise<number> {
  if (!smtpConfigured()) return 0
  const now = new Date()
  const queued = await db.email.findMany({
    where: {
      direction: 'outbound',
      status: 'queued',
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_EMAILS_PER_TICK,
  })
  let delivered = 0
  for (const e of queued) {
    try {
      const messageId = await sendViaSmtp({
        to: JSON.parse(e.toAddresses || '[]'),
        cc: JSON.parse(e.cc || '[]'),
        bcc: JSON.parse(e.bcc || '[]'),
        subject: e.subject,
        html: e.bodyHtml,
        text: e.bodyText || e.bodyHtml.replace(/<[^>]+>/g, ''),
      })
      await db.email.update({
        where: { id: e.id },
        data: { status: 'sent', sentAt: new Date(), messageId },
      })
      delivered++
    } catch (err) {
      // Leave queued; it will retry on the next tick.
      console.warn(`[jobs] email ${e.id} send failed:`, err instanceof Error ? err.message : err)
    }
  }
  return delivered
}

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

async function executeJobAction(actionType: string, config: Record<string, unknown>): Promise<string> {
  switch (actionType) {
    case 'send_email': {
      const to = Array.isArray(config.to) ? (config.to as string[]) : typeof config.to === 'string' ? [config.to] : []
      if (!to.length || !config.subject) return 'skipped: send_email requires config.to + config.subject'
      const html = typeof config.html === 'string' ? config.html : typeof config.body === 'string' ? (config.body as string) : ''
      const messageId = await sendViaSmtp({
        to,
        subject: String(config.subject),
        html,
        text: html.replace(/<[^>]+>/g, ''),
      })
      return `sent (messageId=${messageId || 'n/a'})`
    }
    case 'webhook':
    case 'http': {
      const url = typeof config.url === 'string' ? config.url : ''
      if (!url.startsWith('https://')) return 'skipped: webhook url must be https'
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config.body ?? {}),
          signal: controller.signal,
        })
        return `webhook ${res.status}`
      } finally {
        clearTimeout(timer)
      }
    }
    case 'trash_purge': {
      const days = Number((config.days as number | undefined) ?? TRASH_RETENTION_DAYS)
      const cutoff = new Date(Date.now() - (Number.isFinite(days) ? days : TRASH_RETENTION_DAYS) * 24 * 60 * 60 * 1000)
      let purged = 0
      for (const model of ['lead', 'contact', 'account', 'deal'] as const) {
        const delegate = db[model] as any
        const stale = await delegate.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true }, take: 500 })
        if (stale.length === 0) continue
        const ids = stale.map((r: { id: string }) => r.id)
        await db.customFieldValue.deleteMany({ where: { recordId: { in: ids } } })
        const res = await delegate.deleteMany({ where: { id: { in: ids } } })
        purged += res.count
      }
      return `purged ${purged} record(s) older than ${days}d`
    }
    case 'process_queued_emails': {
      const n = await deliverQueuedEmails()
      return `delivered ${n} queued email(s)`
    }
    default:
      return `skipped: unknown actionType "${actionType}"`
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

let tickRunning = false

// In-memory guards for the additive scheduler chores (single-process dev server).
let lastDateWorkflowSweepAt = 0
let gmailSyncInFlight = false
let integrationSyncInFlight = false
let taskDueSweepInFlight = false
// Secondary in-process dedupe for task-due pings (the durable guard is the
// Task.reminderSentAt column, so restarts cannot spam owners either).
const taskDuePingedToday = new Set<string>()

/**
 * Notify task owners once per day about tasks due within the next 24h.
 * Durable dedupe uses Task.reminderSentAt (previously written by nothing), so
 * a server restart never re-pings. Best-effort and non-fatal by design.
 */
async function notifyDueTasks(): Promise<number> {
  const now = new Date()
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const dedupeCutoff = new Date(now.getTime() - 20 * 60 * 60 * 1000)
  const dueSoon = await db.task.findMany({
    where: {
      status: { notIn: ['completed', 'deferred'] },
      dueDate: { gte: now, lte: horizon },
      OR: [{ reminderSentAt: null }, { reminderSentAt: { lt: dedupeCutoff } }],
    },
    select: { id: true, title: true, ownerId: true, organizationId: true },
    take: 50,
    orderBy: { dueDate: 'asc' },
  })
  let notified = 0
  for (const task of dueSoon) {
    if (!task.ownerId) continue
    if (taskDuePingedToday.has(task.id)) continue
    try {
      await createNotification({
        organizationId: task.organizationId,
        verb: 'task_due',
        targetModule: 'task',
        targetId: task.id,
        targetName: task.title,
        recipientId: task.ownerId,
        data: { message: `Task due soon: ${task.title}` },
      })
      await db.task.update({ where: { id: task.id }, data: { reminderSentAt: new Date() } })
      taskDuePingedToday.add(task.id)
      notified++
    } catch (e) {
      // One task failing must not block the rest of the sweep.
      console.warn('[jobs] task-due notify failed:', e instanceof Error ? e.message : e)
    }
  }
  return notified
}

/**
 * One pass of the job runner. Safe to call concurrently — re-entrant calls no-op.
 *
 * Additive chores (beyond the original ScheduledJob execution):
 *  - Hourly sweep of due date-based workflow rules (never ran automatically before).
 *  - Gmail inbox polling for connected accounts whose syncFrequency elapsed.
 */
export async function runJobTick(): Promise<void> {
  if (tickRunning) return
  tickRunning = true
  try {
    // 0) Additive: hourly date-based workflow sweep.
    if (Date.now() - lastDateWorkflowSweepAt >= DATE_WORKFLOW_SWEEP_INTERVAL_MS) {
      lastDateWorkflowSweepAt = Date.now()
      try {
        const sweep = await runDueDateBasedWorkflowsForAllOrgs()
        if (sweep.fired > 0) console.log(`[jobs] date-based workflow sweep: ${sweep.fired} fired across ${sweep.orgs} org(s)`)
      } catch (e) {
        console.warn('[jobs] date-based workflow sweep failed:', e instanceof Error ? e.message : e)
      }
    }

    // 0b) Additive: Gmail inbox polling (self-limiting to due accounts).
    if (!gmailSyncInFlight) {
      gmailSyncInFlight = true
      try {
        const sync = await syncDueGmailAccounts()
        if (sync.synced > 0 || sync.errors > 0) console.log(`[jobs] gmail poll: ${sync.synced} synced, ${sync.errors} error(s) of ${sync.checked} due`)
      } catch (e) {
        console.warn('[jobs] gmail poll failed:', e instanceof Error ? e.message : e)
      } finally {
        gmailSyncInFlight = false
      }
    }

    // 0c) Additive: API auto-import feeds whose schedule elapsed.
    if (!integrationSyncInFlight) {
      integrationSyncInFlight = true
      try {
        const sync = await syncDueIntegrations()
        if (sync.synced > 0 || sync.failed > 0) console.log(`[jobs] api import: ${sync.synced} synced, ${sync.failed} failed`)
      } catch (e) {
        console.warn('[jobs] api import sweep failed:', e instanceof Error ? e.message : e)
      } finally {
        integrationSyncInFlight = false
      }
    }

    // 0d) Additive: task due-soon pings (owner, once per task per day).
    if (!taskDueSweepInFlight) {
      taskDueSweepInFlight = true
      try {
        const n = await notifyDueTasks()
        if (n > 0) console.log(`[jobs] task due-soon: notified ${n} owner(s)`)
      } catch (e) {
        console.warn('[jobs] task due-soon sweep failed:', e instanceof Error ? e.message : e)
      } finally {
        taskDueSweepInFlight = false
      }
    }

    // 1) System chores (always, cheap).
    try {
      const purged = await purgeOldTrash()
      if (purged > 0) console.log(`[jobs] trash purge: ${purged} record(s)`)
    } catch (e) {
      console.warn('[jobs] trash purge failed:', e instanceof Error ? e.message : e)
    }
    try {
      const delivered = await deliverQueuedEmails()
      if (delivered > 0) console.log(`[jobs] queued email delivery: ${delivered}`)
    } catch (e) {
      console.warn('[jobs] email delivery failed:', e instanceof Error ? e.message : e)
    }

    // 2) Due scheduled jobs.
    const due = await db.scheduledJob.findMany({
      where: { status: 'active', nextRunAt: { lte: new Date() } },
      orderBy: { nextRunAt: 'asc' },
      take: MAX_JOBS_PER_TICK,
    })

    for (const job of due) {
      const log = await db.scheduledJobLog.create({
        data: { organizationId: job.organizationId, jobId: job.id, status: 'running' },
      })
      let outcome = 'ok'
      let errorMessage: string | null = null
      try {
        const config = JSON.parse(job.config || '{}') as Record<string, unknown>
        outcome = await executeJobAction(job.actionType, config)
      } catch (e) {
        errorMessage = e instanceof Error ? e.message : String(e)
        outcome = `failed: ${errorMessage}`
      }
      await db.scheduledJobLog.update({
        where: { id: log.id },
        data: { completedAt: new Date(), status: errorMessage ? 'failed' : 'success', errorMessage },
      })
      // Advance the schedule (or fall back to +5min for unparseable cron so a
      // bad expression can never pin a job).
      const next = nextRunFromCron(job.cronExpression, new Date())
      await db.scheduledJob.update({
        where: { id: job.id },
        data: { lastRunAt: new Date(), nextRunAt: next ?? new Date(Date.now() + 5 * 60 * 1000) },
      })
      console.log(`[jobs] ${job.name} (${job.actionType}) → ${outcome}`)
    }
  } finally {
    tickRunning = false
  }
}
