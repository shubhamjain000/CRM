import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

// ---------------------------------------------------------------------------
// Zia's live CRM data layer.
//
// Two entry points power "the chatbot tells everything":
//  1. buildCrmSnapshot  — headline metrics (counts, pipeline, win rate, CSM
//     cadence, tasks, events) rendered as a compact text block that is injected
//     into the chat system prompt on every request, so the model always has
//     real numbers to quote.
//  2. searchCrmRecords  — the server-executed "tool" behind the model's
//     search_records action: tenant-scoped record lookups for specific people,
//     companies, deals and lists the snapshot cannot cover.
//
// Everything here is strictly organization-scoped; callers pass the tenant ids
// after their own session checks. Errors thrown for bad tool params are
// user-facing (ActionError) and are fed back to the model, never to the chat.
// ---------------------------------------------------------------------------

/** Thrown when tool params fail validation; the message is model/user-facing. */
export class ActionError extends Error {}

const DAY_MS = 86_400_000

const money0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const money = (n: number) => money0.format(n || 0)

function fmtDay(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: tz }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

function fmtDateTime(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d)
  } catch {
    return d.toISOString()
  }
}

/** Parse a JSON-array column (emails/phones) safely; returns string entries. */
function jsonArr(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const first = (a: string[]) => (a.length > 0 ? a[0] : null)

// ---------------------------------------------------------------------------
// 1. Snapshot
// ---------------------------------------------------------------------------

/** CSM steps that represent a finished/hidden cadence — same semantics as src/lib/csm.ts groups. */
const CSM_TERMINAL = new Set(['None', 'Old Lead', 'CSM Loop complete'])

export async function buildCrmSnapshot(orgId: string, userId: string, tz: string): Promise<string> {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS)
  const weekAhead = new Date(now.getTime() + 7 * DAY_MS)
  const monthAhead = new Date(now.getTime() + 30 * DAY_MS)
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS)
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dayEnd = new Date(dayStart.getTime() + DAY_MS)

  const [
    leadTotal,
    leadStatusGroups,
    hotLeads,
    newLeads7d,
    recentLeads,
    contactCount,
    accountCount,
    openDeals,
    wonAgg,
    lostAgg,
    won30Agg,
    myOpenTasks,
    myOverdueTasks,
    myDueTodayTasks,
    upcomingTasks,
    todayEvents,
    weekEvents,
    upcomingEvents,
    csmGroups,
    csmOverdue,
    csmDueToday,
  ] = await Promise.all([
    db.lead.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.lead.groupBy({ by: ['leadStatus'], where: { organizationId: orgId, deletedAt: null }, _count: true }),
    db.lead.count({ where: { organizationId: orgId, deletedAt: null, rating: 'hot', isConverted: false } }),
    db.lead.count({ where: { organizationId: orgId, deletedAt: null, createdAt: { gte: weekAgo } } }),
    db.lead.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: { firstName: true, lastName: true, company: true, leadStatus: true, rating: true },
    }),
    db.contact.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.account.count({ where: { organizationId: orgId, deletedAt: null } }),
    // One scan covers pipeline total, per-stage split, closing windows, overdue and top deals.
    db.deal.findMany({
      where: { organizationId: orgId, deletedAt: null, stage: { isClosed: false } },
      select: {
        name: true, amount: true, closeDate: true,
        stage: { select: { name: true } },
        account: { select: { name: true } },
      },
      take: 1000,
    }),
    db.deal.aggregate({ where: { organizationId: orgId, deletedAt: null, stage: { isWonStage: true } }, _count: true, _sum: { amount: true } }),
    db.deal.aggregate({ where: { organizationId: orgId, deletedAt: null, stage: { isLostStage: true } }, _count: true }),
    db.deal.aggregate({ where: { organizationId: orgId, deletedAt: null, stage: { isWonStage: true }, closeDate: { gte: monthAgo } }, _sum: { amount: true } }),
    db.task.count({ where: { organizationId: orgId, assigneeId: userId, deletedAt: null, status: { notIn: ['completed', 'deferred'] } } }),
    db.task.count({ where: { organizationId: orgId, assigneeId: userId, deletedAt: null, status: { notIn: ['completed', 'deferred'] }, dueDate: { lt: now } } }),
    db.task.count({ where: { organizationId: orgId, assigneeId: userId, deletedAt: null, status: { notIn: ['completed', 'deferred'] }, dueDate: { gte: dayStart, lt: dayEnd } } }),
    db.task.findMany({
      where: { organizationId: orgId, assigneeId: userId, deletedAt: null, status: { notIn: ['completed', 'deferred'] }, dueDate: { gte: now } },
      orderBy: { dueDate: 'asc' },
      take: 4,
      select: { title: true, dueDate: true, priority: true },
    }),
    db.event.count({
      where: {
        organizationId: orgId, deletedAt: null, status: { not: 'cancelled' },
        start: { gte: dayStart, lt: dayEnd },
        OR: [{ organizerId: userId }, { attendees: { some: { userId } } }],
      },
    }),
    db.event.count({
      where: {
        organizationId: orgId, deletedAt: null, status: { not: 'cancelled' },
        start: { gte: now, lte: weekAhead },
        OR: [{ organizerId: userId }, { attendees: { some: { userId } } }],
      },
    }),
    db.event.findMany({
      where: {
        organizationId: orgId, deletedAt: null, status: { not: 'cancelled' },
        start: { gte: now },
        OR: [{ organizerId: userId }, { attendees: { some: { userId } } }],
      },
      orderBy: { start: 'asc' },
      take: 3,
      select: { title: true, start: true, allDay: true },
    }),
    db.contact.groupBy({ by: ['csmNextStep'], where: { organizationId: orgId, deletedAt: null }, _count: true }),
    db.contact.count({ where: { organizationId: orgId, deletedAt: null, csmNextStepDueAt: { lt: now } } }),
    db.contact.count({ where: { organizationId: orgId, deletedAt: null, csmNextStepDueAt: { gte: dayStart, lt: dayEnd } } }),
  ])

  const L: string[] = []
  L.push('── LIVE CRM DATA (refreshed just now — quote these numbers exactly; never invent or estimate) ──')
  L.push('Figures cover your whole organization. "Recently" windows are rolling (7/30 days).')

  // Leads
  const statusTxt = leadStatusGroups
    .sort((a, b) => b._count - a._count)
    .map((g) => `${g.leadStatus} ${g._count}`)
    .join(', ')
  const newest = recentLeads.map((l) => `${l.firstName} ${l.lastName}${l.company ? ` (${l.company})` : ''} — ${l.leadStatus}${l.rating ? ` · ${l.rating}` : ''}`).join(' | ')
  L.push(`Leads: ${leadTotal} total${statusTxt ? ` — status: ${statusTxt}` : ''} | ${newLeads7d} added in last 7 days | ${hotLeads} hot, unconverted`)
  if (newest) L.push(`Newest leads: ${newest}`)

  L.push(`Contacts: ${contactCount} | Accounts: ${accountCount}`)

  // Pipeline (computed from the single open-deals scan)
  let openCount = 0
  let openSum = 0
  const stageMap = new Map<string, { count: number; sum: number }>()
  let close7c = 0
  let close7s = 0
  let close30c = 0
  let close30s = 0
  let overduec = 0
  for (const d of openDeals) {
    openCount++
    openSum += d.amount || 0
    const s = stageMap.get(d.stage.name) ?? { count: 0, sum: 0 }
    s.count++
    s.sum += d.amount || 0
    stageMap.set(d.stage.name, s)
    if (d.closeDate) {
      const t = new Date(d.closeDate).getTime()
      if (t < now.getTime()) overduec++
      else if (t <= weekAhead.getTime()) { close7c++; close7s += d.amount || 0 }
      if (t <= monthAhead.getTime()) { close30c++; close30s += d.amount || 0 }
    }
  }
  const stageTxt = [...stageMap.entries()].sort((a, b) => b[1].sum - a[1].sum).map(([name, v]) => `${name} ${v.count} (${money(v.sum)})`).join(', ')
  L.push(`Open pipeline: ${openCount} deals worth ${money(openSum)}${stageTxt ? ` — by stage: ${stageTxt}` : ''}`)
  L.push(`Closing (open deals): next 7 days ${close7c} (${money(close7s)}) | next 30 days ${close30c} (${money(close30s)}) | past close date but still open ${overduec}`)

  const won = wonAgg._count
  const lost = lostAgg._count
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0
  L.push(`Closed all-time: won ${won} (${money(wonAgg._sum.amount ?? 0)}), lost ${lost} → win rate ${winRate}% | won in last 30 days (by close date): ${money(won30Agg._sum.amount ?? 0)}`)

  const top = [...openDeals].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 5)
    .map((d) => `• ${d.name} — ${money(d.amount)} · ${d.stage.name}${d.account?.name ? ` · ${d.account.name}` : ''}${d.closeDate ? ` · closes ${fmtDay(new Date(d.closeDate), tz)}` : ''}`)
  L.push(top.length > 0 ? `Top open deals:\n${top.join('\n')}` : 'Top open deals: none yet')

  // Deal stages list — helps the model fill search_records' stage param correctly.
  const stages = await db.stage.findMany({
    where: { organizationId: orgId },
    orderBy: { order: 'asc' },
    select: { name: true },
    take: 15,
  })
  if (stages.length > 0) L.push(`Deal stage names (exact, for search): ${stages.map((s) => s.name).join(', ')}`)

  // My work
  const nextTasks = upcomingTasks.map((t) => `${t.title} (${t.dueDate ? fmtDateTime(new Date(t.dueDate), tz) : 'no date'}${t.priority === 'high' || t.priority === 'urgent' ? ` · ${t.priority}` : ''})`).join(' | ')
  L.push(`Your tasks: ${myOpenTasks} open | ${myOverdueTasks} overdue | ${myDueTodayTasks} due today${nextTasks ? ` | next: ${nextTasks}` : ''}`)
  const nextEvents = upcomingEvents.map((e) => `${e.title} (${e.allDay ? fmtDay(new Date(e.start), tz) : fmtDateTime(new Date(e.start), tz)})`).join(' | ')
  L.push(`Your events: ${todayEvents} today | ${weekEvents} in next 7 days${nextEvents ? ` | next: ${nextEvents}` : ''}`)

  // CSM cadence
  let csmActive = 0
  let csmDone = 0
  let csmOld = 0
  const stepParts: string[] = []
  for (const g of csmGroups.sort((a, b) => b._count - a._count)) {
    if (g.csmNextStep === 'CSM Loop complete') csmDone += g._count
    else if (g.csmNextStep === 'Old Lead') csmOld += g._count
    else if (!CSM_TERMINAL.has(g.csmNextStep)) { csmActive += g._count; stepParts.push(`${g.csmNextStep} ${g._count}`) }
  }
  L.push(`CSM cadence: ${csmActive} active loops | ${csmOverdue} follow-ups overdue | ${csmDueToday} due today | ${csmDone} loops complete | ${csmOld} old leads${stepParts.length > 0 ? ` | steps: ${stepParts.join(', ')}` : ''}`)

  L.push('End of data. If a count is 0, say there are none yet. For specific records or filtered lists not covered above, use search_records.')
  return L.join('\n')
}

// ---------------------------------------------------------------------------
// 2. search_records tool
// ---------------------------------------------------------------------------

export interface SearchParams {
  module?: unknown
  q?: unknown
  stage?: unknown
  status?: unknown
  minAmount?: unknown
  maxAmount?: unknown
  sort?: unknown
  limit?: unknown
  includePast?: unknown
}

const SEARCH_MODULES = ['deal', 'lead', 'contact', 'account', 'task', 'event'] as const
const TASK_STATUSES = ['not_started', 'in_progress', 'completed', 'deferred']
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted']

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t.slice(0, max) : undefined
}
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (!Number.isNaN(n)) return n
  }
  return undefined
}

/**
 * Tenant-scoped record lookup executed server-side for the model's
 * search_records action. Returns compact formatted lines (model-facing text,
 * not raw JSON) — "NO_MATCHES: …" when nothing fits.
 */
export async function searchCrmRecords(orgId: string, userId: string, params: SearchParams, tz: string): Promise<string> {
  const mod = (str(params.module, 20) ?? '').toLowerCase()
  if (!mod) throw new ActionError('Which module should I search? (deal, lead, contact, account, task, or event)')
  if (!(SEARCH_MODULES as readonly string[]).includes(mod)) {
    throw new ActionError(`"${mod}" is not searchable. Use one of: ${SEARCH_MODULES.join(', ')}.`)
  }

  const q = str(params.q, 100)
  const stage = str(params.stage, 60)
  const status = str(params.status, 40)
  const minAmount = num(params.minAmount)
  const maxAmount = num(params.maxAmount)
  const limit = Math.min(Math.max(Math.trunc(num(params.limit) ?? 8), 1), 15)
  const sort = str(params.sort, 20)
  const includePast = params.includePast === true
  // Multi-word queries ("Priya Nair", "Acme renewal") must match ALL tokens —
  // a single `contains: q` against per-person fields would never match.
  const tokens = (q ?? '').split(/\s+/).filter(Boolean).slice(0, 5)

  if (mod === 'deal') {
    const where: Prisma.DealWhereInput = { organizationId: orgId, deletedAt: null }
    if (tokens.length > 0) where.AND = tokens.map(t => ({ OR: [{ name: { contains: t } }, { account: { name: { contains: t } } }] }))
    if (stage) where.stage = { name: { contains: stage } }
    if (minAmount !== undefined || maxAmount !== undefined) {
      where.amount = {}
      if (minAmount !== undefined) where.amount.gte = minAmount
      if (maxAmount !== undefined) where.amount.lte = maxAmount
    }
    const orderBy: Prisma.DealOrderByWithRelationInput[] =
      sort === 'amount_asc' ? [{ amount: 'asc' }]
      : sort === 'close_asc' ? [{ closeDate: 'asc' }]
      : sort === 'recent' ? [{ createdAt: 'desc' }]
      : [{ amount: 'desc' }]
    const rows = await db.deal.findMany({
      where,
      orderBy,
      take: limit,
      select: {
        name: true, amount: true, closeDate: true, nextStep: true,
        stage: { select: { name: true, isWonStage: true, isLostStage: true } },
        account: { select: { name: true } },
      },
    })
    if (rows.length === 0) return 'NO_MATCHES: no deals matched that search.'
    return rows.map((d) => {
      const flag = d.stage.isWonStage ? ' · WON' : d.stage.isLostStage ? ' · LOST' : ''
      const bits = [
        `• **${d.name}** — ${money(d.amount)}`,
        `stage: ${d.stage.name}${flag}`,
        d.account?.name ? `account: ${d.account.name}` : null,
        d.closeDate ? `closes ${fmtDay(new Date(d.closeDate), tz)}` : null,
        d.nextStep ? `next step: ${d.nextStep}` : null,
      ]
      return bits.filter(Boolean).join(' · ')
    }).join('\n')
  }

  if (mod === 'lead') {
    const where: Prisma.LeadWhereInput = { organizationId: orgId, deletedAt: null }
    if (tokens.length > 0) where.AND = tokens.map(t => ({ OR: [{ firstName: { contains: t } }, { lastName: { contains: t } }, { company: { contains: t } }, { emails: { contains: t } }] }))
    if (status) {
      if (!LEAD_STATUSES.includes(status.toLowerCase())) throw new ActionError(`"${status}" is not a lead status. Use: ${LEAD_STATUSES.join(', ')}.`)
      where.leadStatus = status.toLowerCase()
    }
    const rows = await db.lead.findMany({
      where,
      orderBy: sort === 'recent' || !sort ? { createdAt: 'desc' } : [{ lastActivity: 'desc' }],
      take: limit,
      select: { firstName: true, lastName: true, company: true, leadStatus: true, rating: true, leadSource: true, isConverted: true, createdAt: true },
    })
    if (rows.length === 0) return 'NO_MATCHES: no leads matched that search.'
    return rows.map((l) => {
      const bits = [
        `• **${l.firstName} ${l.lastName}**`,
        l.company ? `company: ${l.company}` : null,
        `status: ${l.leadStatus}`,
        l.rating ? `rating: ${l.rating}` : null,
        l.leadSource ? `source: ${l.leadSource}` : null,
        l.isConverted ? 'converted' : null,
        `added ${fmtDay(new Date(l.createdAt), tz)}`,
      ]
      return bits.filter(Boolean).join(' · ')
    }).join('\n')
  }

  if (mod === 'contact') {
    const where: Prisma.ContactWhereInput = { organizationId: orgId, deletedAt: null }
    if (tokens.length > 0) where.AND = tokens.map(t => ({ OR: [{ firstName: { contains: t } }, { lastName: { contains: t } }, { emails: { contains: t } }, { account: { name: { contains: t } } }, { title: { contains: t } }] }))
    const rows = await db.contact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { firstName: true, lastName: true, title: true, emails: true, phones: true, csmNextStep: true, csmNextStepDueAt: true, account: { select: { name: true } } },
    })
    if (rows.length === 0) return 'NO_MATCHES: no contacts matched that search.'
    return rows.map((c) => {
      const email = first(jsonArr(c.emails))
      const phone = first(jsonArr(c.phones))
      const bits = [
        `• **${c.firstName} ${c.lastName}**`,
        c.title ? `title: ${c.title}` : null,
        c.account?.name ? `account: ${c.account.name}` : null,
        email ? `email: ${email}` : null,
        phone ? `phone: ${phone}` : null,
        `next step: ${c.csmNextStep || 'None'}${c.csmNextStepDueAt ? ` (due ${fmtDay(new Date(c.csmNextStepDueAt), tz)})` : ''}`,
      ]
      return bits.filter(Boolean).join(' · ')
    }).join('\n')
  }

  if (mod === 'account') {
    const where: Prisma.AccountWhereInput = { organizationId: orgId, deletedAt: null }
    if (tokens.length > 0) where.AND = tokens.map(t => ({ OR: [{ name: { contains: t } }, { industry: { contains: t } }, { website: { contains: t } }] }))
    const rows = await db.account.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { name: true, industry: true, accountType: true, annualRevenue: true, employees: true, website: true, _count: { select: { contacts: true, deals: true } } },
    })
    if (rows.length === 0) return 'NO_MATCHES: no accounts matched that search.'
    return rows.map((a) => {
      const bits = [
        `• **${a.name}**`,
        a.industry ? `industry: ${a.industry}` : null,
        `type: ${a.accountType}`,
        a.annualRevenue ? `revenue: ${money(a.annualRevenue)}` : null,
        a.employees ? `${a.employees} employees` : null,
        `${a._count.contacts} contacts · ${a._count.deals} deals`,
      ]
      return bits.filter(Boolean).join(' · ')
    }).join('\n')
  }

  if (mod === 'task') {
    const where: Prisma.TaskWhereInput = { organizationId: orgId, deletedAt: null, assigneeId: userId }
    if (tokens.length > 0) where.AND = tokens.map(t => ({ title: { contains: t } }))
    if (status) {
      if (!TASK_STATUSES.includes(status.toLowerCase())) throw new ActionError(`"${status}" is not a task status. Use: ${TASK_STATUSES.join(', ')}.`)
      where.status = status.toLowerCase()
    } else {
      where.status = { notIn: ['completed', 'deferred'] }
    }
    const rows = await db.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { title: true, dueDate: true, priority: true, status: true },
    })
    // Sort in JS so tasks without a due date land last.
    const sorted = rows.sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY
      return ad - bd
    }).slice(0, limit)
    if (sorted.length === 0) return 'NO_MATCHES: no tasks matched that search.'
    return sorted.map((t) => {
      const bits = [
        `• **${t.title}**`,
        `status: ${t.status}`,
        `priority: ${t.priority}`,
        t.dueDate ? `due ${fmtDateTime(new Date(t.dueDate), tz)}` : 'no due date',
      ]
      return bits.filter(Boolean).join(' · ')
    }).join('\n')
  }

  // event
  const now = new Date()
  const where: Prisma.EventWhereInput = {
    organizationId: orgId, deletedAt: null, status: { not: 'cancelled' },
    OR: [{ organizerId: userId }, { attendees: { some: { userId } } }],
  }
  if (tokens.length > 0) where.AND = tokens.map(t => ({ title: { contains: t } }))
  if (!includePast) where.start = { gte: now }
  const rows = await db.event.findMany({
    where,
    orderBy: includePast ? { start: 'desc' } : { start: 'asc' },
    take: limit,
    select: { title: true, start: true, end: true, allDay: true, location: true },
  })
  if (rows.length === 0) return includePast ? 'NO_MATCHES: no events matched that search.' : 'NO_MATCHES: no upcoming events matched that search. Try includePast: true.'
  return rows.map((e) => {
    const time = e.allDay
      ? `${fmtDay(new Date(e.start), tz)} (all day)`
      : `${fmtDateTime(new Date(e.start), tz)} – ${fmtDateTime(new Date(e.end), tz)}`
    const bits = [`• **${e.title}**`, time, e.location ? `location: ${e.location}` : null]
    return bits.filter(Boolean).join(' · ')
  }).join('\n')
}
