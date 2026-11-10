import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { CSM_STEPS, csmStepMeta } from '@/lib/csm'

export const dynamic = 'force-dynamic'

const DAY = 86_400_000

function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function displayName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim()
}

/**
 * BI feed for the Unstop CSM cadence. Reads Contact.csmNextStep* columns —
 * every rep action (row menu, detail card, form, bulk edit) lands here
 * automatically with no extra configuration.
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id
    const base = { organizationId: orgId, deletedAt: null }

    const now = new Date()
    const startToday = new Date(now)
    startToday.setHours(0, 0, 0, 0)
    const endToday = new Date(startToday.getTime() + DAY - 1)
    // "Due within 7 days" includes the 7th day in full (matches the contacts
    // list filter, so a "Day 7" step set today is always counted).
    const endWeek = new Date(startToday.getTime() + 7 * DAY)
    endWeek.setHours(23, 59, 59, 999)
    const trendStart = new Date(startToday.getTime() - 13 * DAY)

    const [total, byStepRows, overdue, dueToday, dueThisWeek, upcomingRaw, changedRaw] = await Promise.all([
      db.contact.count({ where: base }),
      db.contact.groupBy({ by: ['csmNextStep'], where: base, _count: { _all: true } }),
      db.contact.count({ where: { ...base, csmNextStepDueAt: { lt: startToday } } }),
      db.contact.count({ where: { ...base, csmNextStepDueAt: { gte: startToday, lte: endToday } } }),
      db.contact.count({ where: { ...base, csmNextStepDueAt: { gt: endToday, lte: endWeek } } }),
      db.contact.findMany({
        where: { ...base, csmNextStepDueAt: { not: null } },
        orderBy: { csmNextStepDueAt: 'asc' },
        take: 50,
        select: {
          id: true, firstName: true, lastName: true,
          csmNextStep: true, csmNextStepDueAt: true, ownerId: true, accountId: true,
        },
      }),
      db.contact.findMany({
        where: { ...base, csmNextStepAt: { gte: trendStart } },
        select: { csmNextStepAt: true },
      }),
    ])

    const ownerIds = [...new Set(upcomingRaw.map((c) => c.ownerId).filter(Boolean))]
    const accountIds = [...new Set(upcomingRaw.map((c) => c.accountId).filter((x): x is string => Boolean(x)))]
    const [owners, accounts] = await Promise.all([
      ownerIds.length
        ? db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
        : Promise.resolve([] as { id: string; name: string }[]),
      accountIds.length
        ? db.account.findMany({ where: { id: { in: accountIds }, organizationId: orgId }, select: { id: true, name: true } })
        : Promise.resolve([] as { id: string; name: string }[]),
    ])

    const ownerMap = new Map(owners.map((u) => [u.id, u.name]))
    const accountMap = new Map(accounts.map((a) => [a.id, a.name]))

    const countByStep = new Map(byStepRows.map((r) => [r.csmNextStep, r._count._all]))
    const distribution = CSM_STEPS.map((s) => ({
      value: s.value,
      tone: s.tone,
      count: countByStep.get(s.value) ?? 0,
    }))

    const active = distribution
      .filter((d) => csmStepMeta(d.value).days !== null)
      .reduce((sum, d) => sum + d.count, 0)
    const loopComplete = countByStep.get('CSM Loop complete') ?? 0
    const oldLeads = countByStep.get('Old Lead') ?? 0
    const loopRate = active + loopComplete > 0 ? Math.round((loopComplete / (active + loopComplete)) * 100) : 0

    const upcoming = upcomingRaw.map((c) => {
      const due = c.csmNextStepDueAt ? new Date(c.csmNextStepDueAt) : null
      return {
        id: c.id,
        name: displayName(c.firstName, c.lastName),
        account: c.accountId ? accountMap.get(c.accountId) ?? null : null,
        owner: c.ownerId ? ownerMap.get(c.ownerId) ?? null : null,
        step: c.csmNextStep,
        dueAt: due ? due.toISOString() : null,
        overdue: due ? due.getTime() < now.getTime() : false,
        dueToday: due ? due.getTime() >= startToday.getTime() && due.getTime() <= endToday.getTime() : false,
      }
    })

    // Cadence activity — steps set per day over the last 14 days.
    const trend: { date: string; label: string; count: number }[] = []
    for (let i = 0; i < 14; i++) {
      const day = new Date(trendStart.getTime() + i * DAY)
      trend.push({
        date: localDateKey(day),
        label: day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        count: 0,
      })
    }
    const trendIndex = new Map(trend.map((t, i) => [t.date, i]))
    for (const row of changedRaw) {
      if (!row.csmNextStepAt) continue
      const idx = trendIndex.get(localDateKey(new Date(row.csmNextStepAt)))
      if (idx !== undefined) trend[idx].count += 1
    }

    return NextResponse.json({
      totals: { total, active, overdue, dueToday, dueThisWeek, loopComplete, oldLeads, loopRate },
      distribution,
      upcoming,
      trend,
    })
  } catch (e) {
    const status = e instanceof Error && e.message === 'Unauthorized' ? 401
      : e instanceof Error && e.message === 'No organization' ? 403 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}
