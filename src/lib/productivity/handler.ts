import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { logActivity } from '@/lib/crm/ux'
import { formatDurationLabel } from '@/lib/call-tracking'

type Model = 'task' | 'event' | 'call'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

/**
 * Generic tenant-scoped CRUD for productivity models.
 */
export async function listProd(
  model: Model,
  opts: { filters?: Record<string, string>; sort?: string; limit?: number } = {},
) {
  const { session, tenant } = await ctx()
  const delegate = db[model] as any
  const where: Record<string, unknown> = {
    organizationId: tenant.organization.id,
    deletedAt: null,
  }
  if (model === 'task') {
    if (opts.filters?.status) where.status = opts.filters.status
    if (opts.filters?.priority) where.priority = opts.filters.priority
    if (opts.filters?.assigneeId) where.assigneeId = opts.filters.assigneeId
    if (opts.filters?.dueBefore) where.dueDate = { lte: new Date(opts.filters.dueBefore) }
    if (opts.filters?.dueAfter) where.dueDate = { gte: new Date(opts.filters.dueAfter) }
  }
  if (model === 'event') {
    if (opts.filters?.startAfter) where.start = { gte: new Date(opts.filters.startAfter) }
    if (opts.filters?.startBefore) where.start = { ...where.start as object, lte: new Date(opts.filters.startBefore) }
    if (opts.filters?.organizerId) where.organizerId = opts.filters.organizerId
  }
  if (model === 'call') {
    if (opts.filters?.callType) where.callType = opts.filters.callType
    if (opts.filters?.outcome) where.outcome = opts.filters.outcome
  }

  const orderBy: Record<string, 'asc' | 'desc'> = {}
  if (opts.sort) {
    const desc = opts.sort.startsWith('-')
    const field = desc ? opts.sort.slice(1) : opts.sort
    orderBy[field] = desc ? 'desc' : 'asc'
  } else {
    orderBy[model === 'event' ? 'start' : 'createdAt'] = 'desc'
  }

  return delegate.findMany({
    where,
    orderBy,
    take: Math.min(opts.limit ?? 100, 200),
    include: model === 'event' ? { attendees: true, meeting: true } : undefined,
  })
}

export async function createProd(model: Model, data: Record<string, unknown>) {
  const { session, tenant } = await ctx()
  const delegate = db[model] as any
  const payload: Record<string, unknown> = {
    ...data,
    organizationId: tenant.organization.id,
  }
  // ownerId exists on Task and Call; Event uses organizerId
  if (model !== 'event') {
    payload.ownerId = data.ownerId ?? session.userId
  }
  if (model === 'task') payload.createdById = session.userId
  if (model === 'event') payload.organizerId = data.organizerId ?? session.userId

  // Convert ISO date strings to Date objects for Prisma
  for (const field of ['dueDate', 'reminder', 'start', 'end', 'startedAt', 'endedAt', 'timerStartedAt']) {
    if (payload[field] && typeof payload[field] === 'string') {
      payload[field] = new Date(payload[field] as string)
    }
  }

  const record = await delegate.create({ data: payload })
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: `${model}.create`,
    targetType: model,
    targetId: record.id,
  })
  // Real-time push
  if (model === 'task' && payload.assigneeId && payload.assigneeId !== session.userId) {
    await pushRealtime(`user:${payload.assigneeId}`, 'task.assigned', { task: record, assigneeId: payload.assigneeId })
  }
  if (model === 'event') {
    await pushRealtime(`user:${session.userId}`, 'event.invited', { event: record, attendeeId: session.userId })
  }
  // Calls auto-log to the related record's activity timeline + notify its owner.
  if (model === 'call') {
    await afterCallCreated(record, session.userId, tenant.organization.id)
  }
  return record
}

export async function updateProd(model: Model, id: string, data: Record<string, unknown>) {
  const { session, tenant } = await ctx()
  const delegate = db[model] as any
  const payload = { ...data }
  // Convert ISO date strings to Date objects for Prisma
  for (const field of ['dueDate', 'reminder', 'start', 'end', 'startedAt', 'endedAt', 'timerStartedAt']) {
    if (payload[field] && typeof payload[field] === 'string') {
      payload[field] = new Date(payload[field] as string)
    }
  }
  // Calls keep their linked activity in sync — grab the row BEFORE the update
  // (relatedModule/relatedId are never user-editable, so `before` carries them).
  const beforeCall = model === 'call'
    ? await delegate.findFirst({ where: { id, organizationId: tenant.organization.id, deletedAt: null } })
    : null
  await delegate.updateMany({
    where: { id, organizationId: tenant.organization.id, deletedAt: null },
    data: payload,
  })
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: `${model}.update`,
    targetType: model,
    targetId: id,
  })
  if (model === 'call' && beforeCall) {
    await afterCallUpdated(id, beforeCall, payload, session.userId, tenant.organization.id)
  }
}

// ---------------------------------------------------------------------------
// Call → activity timeline + owner notification sync
// ---------------------------------------------------------------------------

const CALL_OUTCOME_LABEL: Record<string, string> = {
  connected: 'Connected',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  busy: 'Busy',
}

/** Timeline wording for a call: missed-style outcomes read as "Missed call", connected ones include the human talk time. */
function callActivityDescription(call: { outcome?: unknown; callType?: unknown; duration?: unknown }): string {
  const outcome = String(call.outcome ?? 'connected')
  const callType = String(call.callType ?? 'outbound')
  if (['no_answer', 'busy', 'voicemail'].includes(outcome) || callType === 'missed') {
    return 'Missed call — no answer'
  }
  const seconds = Math.max(0, Math.floor(Number(call.duration ?? 0) || 0))
  return `Call completed · ${formatDurationLabel(seconds)} · ${CALL_OUTCOME_LABEL[outcome] ?? outcome}`
}

/** metadata JSON stored on the linked Activity (callId lets edits re-find it). */
function callMetadata(call: Record<string, unknown>): Record<string, unknown> {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null)
  return {
    callId: String(call.id ?? ''),
    callType: call.callType ?? null,
    outcome: call.outcome ?? null,
    durationSec: Number.isFinite(Number(call.duration)) ? Number(call.duration) : 0,
    startedAt: iso(call.startedAt),
    endedAt: iso(call.endedAt),
    ...(typeof call.notes === 'string' && call.notes.trim() ? { notes: call.notes.trim() } : {}),
  }
}

function metadataCallId(raw: string | null | undefined): string | null {
  try {
    const parsed = JSON.parse(raw ?? '{}') as { callId?: unknown }
    return typeof parsed?.callId === 'string' ? parsed.callId : null
  } catch {
    return null
  }
}

/** Loose-reference lookup of the related CRM record (owner + display name). */
async function relatedRecordInfo(moduleName: string, recordId: string, organizationId: string): Promise<{ ownerId: string | null; name: string }> {
  try {
    const delegate = (db as unknown as Record<string, { findFirst?: (args: Record<string, unknown>) => Promise<unknown> }>)[moduleName]
    if (!delegate?.findFirst) return { ownerId: null, name: '' }
    // Full-row read (no select) — related modules are the standard CRM models
    // but the loose reference pattern means the shape must stay tolerant.
    const row = (await delegate.findFirst({ where: { id: recordId, organizationId } })) as Record<string, unknown> | null
    if (!row) return { ownerId: null, name: '' }
    const name =
      (typeof row.name === 'string' && row.name) ||
      [row.firstName, row.lastName].filter((v) => typeof v === 'string' && v).join(' ') ||
      (typeof row.company === 'string' && row.company) ||
      ''
    return { ownerId: typeof row.ownerId === 'string' ? row.ownerId : null, name }
  } catch {
    return { ownerId: null, name: '' }
  }
}

/**
 * After a call is created: log a `called` activity on the related record,
 * notify the record's owner (when someone else made the call) and push the
 * realtime `call.logged` event so open detail views refresh their timeline.
 */
async function afterCallCreated(call: Record<string, unknown>, actingUserId: string, organizationId: string) {
  const relatedModule = typeof call.relatedModule === 'string' ? call.relatedModule : ''
  const relatedId = typeof call.relatedId === 'string' ? call.relatedId : ''
  if (!relatedModule || !relatedId) return

  const description = callActivityDescription(call)
  const metadata = callMetadata(call)

  // 1. Activity on the related record — never blocks the call save itself.
  try {
    await logActivity({
      module: relatedModule,
      recordId: relatedId,
      action: 'called',
      description,
      metadata,
    })
  } catch { /* best-effort */ }

  const info = await relatedRecordInfo(relatedModule, relatedId, organizationId)
  const recordName = info.name || String(call.subject ?? '').replace(/^Call — /, '')

  // 2. Notify the record owner when the call was made by someone else.
  if (info.ownerId && info.ownerId !== actingUserId) {
    try {
      // Dynamic import: realtime/handler imports pushRealtime from this module.
      const { createNotification } = await import('@/lib/realtime/handler')
      await createNotification({
        actorId: actingUserId,
        verb: 'call',
        targetModule: relatedModule,
        targetId: relatedId,
        targetName: recordName,
        recipientId: info.ownerId,
        channel: 'in_app',
        data: { callId: call.id, outcome: call.outcome ?? null, durationSec: metadata.durationSec, message: `Call completed with ${recordName}` },
      })
    } catch { /* best-effort */ }
  }

  // 3. Realtime refresh for open detail views (whitelisted event in the realtime service).
  try {
    await pushRealtime(`user:${actingUserId}`, 'call.logged', { call, relatedModule, relatedId, recordName })
  } catch { /* best-effort */ }
}

/**
 * After a call is edited (duration / outcome / endedAt / notes): keep the
 * linked `called` activity in sync — update its description + metadata, or
 * create one if the call was somehow logged without an activity.
 */
async function afterCallUpdated(callId: string, before: Record<string, unknown>, changes: Record<string, unknown>, actingUserId: string, organizationId: string) {
  const relatedModule = typeof before.relatedModule === 'string' ? before.relatedModule : ''
  const relatedId = typeof before.relatedId === 'string' ? before.relatedId : ''
  const touched = ['duration', 'outcome', 'endedAt', 'notes'].some((k) => changes[k] !== undefined)
  if (!relatedModule || !relatedId || !touched) return

  // Re-read so description/metadata reflect the merged result.
  let call = before
  try {
    const fresh = await (db.call as any).findFirst({ where: { id: callId, organizationId } })
    if (fresh) call = fresh as Record<string, unknown>
  } catch { /* fall back to the pre-update row */ }

  const notes = typeof call.notes === 'string' ? call.notes.trim() : ''
  let description = callActivityDescription(call)
  if (notes) description = `${description} — ${notes}`
  const metadata = callMetadata(call)

  // The most recent `called` activity whose metadata carries this callId.
  let linkedId: string | null = null
  try {
    const candidates = await db.activity.findMany({
      where: { organizationId, module: relatedModule, recordId: relatedId, action: 'called' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    })
    linkedId = candidates.find((a) => metadataCallId(a.metadata) === callId)?.id ?? null
  } catch { /* best-effort */ }

  try {
    if (linkedId) {
      await db.activity.update({
        where: { id: linkedId },
        data: { description, metadata: JSON.stringify(metadata) },
      })
    } else {
      await logActivity({ module: relatedModule, recordId: relatedId, action: 'called', description, metadata })
    }
  } catch { /* best-effort */ }

  try {
    await pushRealtime(`user:${actingUserId}`, 'call.logged', { call, relatedModule, relatedId, recordName: '' })
  } catch { /* best-effort */ }
}

export async function deleteProd(model: Model, id: string) {
  const { session, tenant } = await ctx()
  const delegate = db[model] as any
  await delegate.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { deletedAt: new Date() },
  })
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: `${model}.delete`,
    targetType: model,
    targetId: id,
  })
}

/**
 * Conflict detection: find overlapping events for the current user.
 */
export async function detectConflicts(start: Date, end: Date, excludeId?: string) {
  const { session, tenant } = await ctx()
  return db.event.findMany({
    where: {
      organizationId: tenant.organization.id,
      deletedAt: null,
      status: { not: 'cancelled' },
      OR: [
        { organizerId: session.userId },
        { attendees: { some: { userId: session.userId } } },
      ],
      start: { lt: end },
      end: { gt: start },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, title: true, start: true, end: true },
    take: 50,
  })
}

/**
 * Push a real-time event to the WebSocket service.
 *
 * The `x-internal-key` header must EXACTLY match the secret the realtime
 * service is configured with (`REALTIME_INTERNAL_KEY` env var, dev fallback
 * otherwise). The realtime service rejects anything else.
 */
const REALTIME_SECRET = process.env.REALTIME_INTERNAL_KEY?.trim() || 'dev-insecure-realtime-key'

export async function pushRealtime(room: string, event: string, data: unknown) {
  try {
    await fetch('http://localhost:3003/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': REALTIME_SECRET },
      body: JSON.stringify({ room, event, data }),
    })
  } catch {
    // Real-time service may not be running; fail silently.
  }
}

/**
 * Today's tasks for the current user.
 */
export async function getTodayTasks() {
  const { session, tenant } = await ctx()
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end = new Date(); end.setHours(23, 59, 59, 999)
  return db.task.findMany({
    where: {
      organizationId: tenant.organization.id,
      assigneeId: session.userId,
      deletedAt: null,
      status: { not: 'completed' },
      OR: [
        { dueDate: { gte: start, lte: end } },
        { dueDate: { lt: start } }, // overdue
      ],
    },
    orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
    take: 100,
  })
}

/**
 * Upcoming meetings (next 7 days).
 */
export async function getUpcomingEvents() {
  const { session, tenant } = await ctx()
  const now = new Date()
  const week = new Date(now.getTime() + 7 * 86400000)
  return db.event.findMany({
    where: {
      organizationId: tenant.organization.id,
      deletedAt: null,
      status: { not: 'cancelled' },
      start: { gte: now, lte: week },
      OR: [{ organizerId: session.userId }, { attendees: { some: { userId: session.userId } } }],
    },
    orderBy: { start: 'asc' },
    take: 10,
  })
}

/**
 * Productivity stats for the dashboard.
 */
export async function getStats() {
  const { session, tenant } = await ctx()
  const [today, overdue, completed, inProgress, notStarted] = await Promise.all([
    db.task.count({ where: { organizationId: tenant.organization.id, assigneeId: session.userId, deletedAt: null, status: { not: 'completed' } } }),
    db.task.count({ where: { organizationId: tenant.organization.id, assigneeId: session.userId, deletedAt: null, status: { not: 'completed' }, dueDate: { lt: new Date() } } }),
    db.task.count({ where: { organizationId: tenant.organization.id, assigneeId: session.userId, deletedAt: null, status: 'completed' } }),
    db.task.count({ where: { organizationId: tenant.organization.id, assigneeId: session.userId, deletedAt: null, status: 'in_progress' } }),
    db.task.count({ where: { organizationId: tenant.organization.id, assigneeId: session.userId, deletedAt: null, status: 'not_started' } }),
  ])
  return { total: today, overdue, completed, inProgress, notStarted }
}
