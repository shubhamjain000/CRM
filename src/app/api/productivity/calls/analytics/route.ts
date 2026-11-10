import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
export const dynamic = 'force-dynamic'

/**
 * Team call analytics.
 *
 * Per member of the current organization:
 *  - callsMade        outbound dials logged in the range (auto-logged or manual)
 *  - received         incoming calls logged for them (auto-logged on return)
 *  - connected        dials that became real conversations (outcome=connected —
 *                     the auto-log marks a dial connected once it crosses the
 *                     10s connect threshold)
 *  - talkTimeSeconds  sum of duration across connected calls. Duration is TALK
 *                     time: it starts counting at connect (dial + 10s ring),
 *                     not at the dial, so ring time never inflates it.
 *  - backlog          open tasks still not done after their due day rolled past
 *                     12 AM IST — i.e. work not attempted on the same day.
 *
 * Day boundaries use IST (UTC+5:30) regardless of server timezone, so the
 * "same day" definition matches an Indian sales team's working day.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
/** Seconds from dial after which a call counts as connected (ring phase length). */
const CONNECT_THRESHOLD_SECONDS = 10
const RANGES = ['today', '7d', '30d', 'all'] as const
type Range = (typeof RANGES)[number]

/** UTC instant of the most recent IST midnight (00:00 IST today). */
function istMidnightUtc(now = new Date()): Date {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS)
  const istDayStart = Math.floor(istNow.getTime() / 86_400_000) * 86_400_000
  return new Date(istDayStart - IST_OFFSET_MS)
}

export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const organizationId = tenant.organization.id

    const url = new URL(req.url)
    const rangeParam = url.searchParams.get('range') ?? 'today'
    const range: Range = (RANGES as readonly string[]).includes(rangeParam)
      ? (rangeParam as Range) : 'today'

    const now = new Date()
    const dayStartIst = istMidnightUtc(now)
    const rangeStart =
      range === 'today' ? dayStartIst
      : range === '7d' ? new Date(now.getTime() - 7 * 86_400_000)
      : range === '30d' ? new Date(now.getTime() - 30 * 86_400_000)
      : null // all time

    const callWhere = {
      organizationId,
      deletedAt: null,
      ...(rangeStart ? { startedAt: { gte: rangeStart } } : {}),
    }

    const [members, madeRows, receivedRows, connectedRows, backlogByAssignee, backlogByOwner] = await Promise.all([
      db.tenantMembership.findMany({
        where: { organizationId, isActive: true },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      // Outbound dials made, grouped by owner (incoming calls don't inflate this)
      db.call.groupBy({
        by: ['ownerId'],
        where: { ...callWhere, callType: 'outbound' },
        _count: { _all: true },
      }),
      // Incoming calls received, grouped by owner
      db.call.groupBy({
        by: ['ownerId'],
        where: { ...callWhere, callType: 'inbound' },
        _count: { _all: true },
      }),
      // Connected conversations + their talk time, grouped by owner.
      // outcome alone decides "connected" — duration is talk time now (it
      // starts at connect), so short connected calls must not be dropped.
      db.call.groupBy({
        by: ['ownerId'],
        where: { ...callWhere, outcome: 'connected' },
        _count: { _all: true },
        _sum: { duration: true },
      }),
      // Backlog: open tasks whose due day rolled past 12 AM IST, by assignee
      db.task.groupBy({
        by: ['assigneeId'],
        where: {
          organizationId,
          deletedAt: null,
          status: { notIn: ['completed', 'deferred'] },
          dueDate: { lt: dayStartIst },
          assigneeId: { not: null },
        },
        _count: { _all: true },
      }),
      // Same, for tasks with no assignee but an owner
      db.task.groupBy({
        by: ['ownerId'],
        where: {
          organizationId,
          deletedAt: null,
          status: { notIn: ['completed', 'deferred'] },
          dueDate: { lt: dayStartIst },
          assigneeId: null,
        },
        _count: { _all: true },
      }),
    ])

    const made = new Map<string, number>()
    for (const r of madeRows) made.set(r.ownerId, r._count._all)

    const received = new Map<string, number>()
    for (const r of receivedRows) received.set(r.ownerId, r._count._all)

    const connected = new Map<string, number>()
    const talk = new Map<string, number>()
    for (const r of connectedRows) {
      connected.set(r.ownerId, r._count._all)
      talk.set(r.ownerId, r._sum.duration ?? 0)
    }

    const backlog = new Map<string, number>()
    for (const r of backlogByAssignee) {
      if (r.assigneeId) backlog.set(r.assigneeId, (backlog.get(r.assigneeId) ?? 0) + r._count._all)
    }
    for (const r of backlogByOwner) {
      backlog.set(r.ownerId, (backlog.get(r.ownerId) ?? 0) + r._count._all)
    }

    const rows = members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      callsMade: made.get(m.user.id) ?? 0,
      received: received.get(m.user.id) ?? 0,
      connected: connected.get(m.user.id) ?? 0,
      talkTimeSeconds: talk.get(m.user.id) ?? 0,
      backlog: backlog.get(m.user.id) ?? 0,
    }))

    const totals = rows.reduce(
      (acc, r) => ({
        callsMade: acc.callsMade + r.callsMade,
        received: acc.received + r.received,
        connected: acc.connected + r.connected,
        talkTimeSeconds: acc.talkTimeSeconds + r.talkTimeSeconds,
        backlog: acc.backlog + r.backlog,
      }),
      { callsMade: 0, received: 0, connected: 0, talkTimeSeconds: 0, backlog: 0 },
    )

    return NextResponse.json({
      range,
      rangeStart: rangeStart ? rangeStart.toISOString() : null,
      istDayStart: dayStartIst.toISOString(),
      connectedThresholdSeconds: CONNECT_THRESHOLD_SECONDS,
      members: rows,
      totals,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
