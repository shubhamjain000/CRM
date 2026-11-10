import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

/* ------------------------------------------------------------------ */
/* Shared metric computation — every dashboard metric in one pass      */
/* ------------------------------------------------------------------ */

export interface OrgMetrics {
  revenue: number
  openDeals: number
  winRate: number
  totalLeads: number
  myTasks: number
  overdueTasks: number
  upcomingEvents: number
  calls: number
  emails: number
  wonDeals: number
  pipeline: number
}

/**
 * Compute every dashboard metric for an org in parallel (single round of
 * queries). `userId` scopes the per-user metrics (my tasks / overdue).
 */
export async function computeMetrics(orgId: string, userId: string): Promise<OrgMetrics> {
  const now = new Date()
  const [revenueAgg, openDeals, wonDeals, lostDeals, totalLeads, myTasks, overdueTasks, upcomingEvents, calls, emails, pipelineAgg] = await Promise.all([
    db.deal.aggregate({ where: { organizationId: orgId, deletedAt: null }, _sum: { amount: true } }),
    db.deal.count({ where: { organizationId: orgId, deletedAt: null, stage: { isClosed: false } } }),
    db.deal.count({ where: { organizationId: orgId, deletedAt: null, stage: { isWonStage: true } } }),
    db.deal.count({ where: { organizationId: orgId, deletedAt: null, stage: { isLostStage: true } } }),
    db.lead.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.task.count({ where: { organizationId: orgId, assigneeId: userId, deletedAt: null, status: { not: 'completed' } } }),
    db.task.count({ where: { organizationId: orgId, assigneeId: userId, status: { not: 'completed' }, dueDate: { lt: now } } }),
    db.event.count({ where: { organizationId: orgId, deletedAt: null, start: { gte: now } } }),
    db.telephonyCall.count({ where: { organizationId: orgId } }),
    db.email.count({ where: { organizationId: orgId, direction: 'outbound' } }),
    db.deal.aggregate({ where: { organizationId: orgId, deletedAt: null, stage: { isClosed: false } }, _sum: { amount: true } }),
  ])
  const winRate = wonDeals + lostDeals > 0 ? (wonDeals / (wonDeals + lostDeals)) * 100 : 0
  return {
    revenue: revenueAgg._sum.amount ?? 0,
    openDeals,
    winRate,
    totalLeads,
    myTasks,
    overdueTasks,
    upcomingEvents,
    calls,
    emails,
    wonDeals,
    pipeline: pipelineAgg._sum.amount ?? 0,
  }
}

/* ------------------------------------------------------------------ */
/* Widget metric catalogue                                             */
/* ------------------------------------------------------------------ */

/** Whitelisted dashboard widget metric types — anything else is rejected. */
export const WIDGET_METRIC_TYPES = [
  'revenue', 'open_deals', 'win_rate', 'total_leads', 'my_tasks', 'overdue_tasks',
  'upcoming_events', 'calls', 'emails', 'won_deals', 'pipeline', 'leaderboard',
] as const

export type WidgetMetricType = (typeof WIDGET_METRIC_TYPES)[number]

export type WidgetMetricFormat = 'currency' | 'number' | 'percent' | 'leaderboard'

export const WIDGET_COLOR_THEMES = ['default', 'emerald', 'amber', 'rose', 'sky'] as const

export const WIDGET_DEFAULT_TITLES: Record<WidgetMetricType, string> = {
  revenue: 'Total Revenue',
  open_deals: 'Open Deals',
  win_rate: 'Win Rate',
  total_leads: 'Total Leads',
  my_tasks: 'My Tasks',
  overdue_tasks: 'Overdue Tasks',
  upcoming_events: 'Upcoming Events',
  calls: 'Calls',
  emails: 'Emails',
  won_deals: 'Won Deals',
  pipeline: 'Pipeline',
  leaderboard: 'Leaderboard',
}

/** Map a metric type to its live value + display format. */
export function widgetValue(metrics: OrgMetrics, widgetType: string): { value: number; format: WidgetMetricFormat } {
  switch (widgetType) {
    case 'revenue': return { value: metrics.revenue, format: 'currency' }
    case 'open_deals': return { value: metrics.openDeals, format: 'number' }
    case 'win_rate': return { value: metrics.winRate, format: 'percent' }
    case 'total_leads': return { value: metrics.totalLeads, format: 'number' }
    case 'my_tasks': return { value: metrics.myTasks, format: 'number' }
    case 'overdue_tasks': return { value: metrics.overdueTasks, format: 'number' }
    case 'upcoming_events': return { value: metrics.upcomingEvents, format: 'number' }
    case 'calls': return { value: metrics.calls, format: 'number' }
    case 'emails': return { value: metrics.emails, format: 'number' }
    case 'won_deals': return { value: metrics.wonDeals, format: 'number' }
    case 'pipeline': return { value: metrics.pipeline, format: 'currency' }
    case 'leaderboard': return { value: 0, format: 'leaderboard' }
    default: return { value: 0, format: 'number' }
  }
}

/** Widgets seeded for every fresh default dashboard. */
const DEFAULT_WIDGET_SEED: { type: WidgetMetricType }[] = [
  { type: 'revenue' },
  { type: 'open_deals' },
  { type: 'win_rate' },
  { type: 'total_leads' },
]

/* ------------------------------------------------------------------ */
/* Default dashboard bootstrap                                         */
/* ------------------------------------------------------------------ */

/**
 * Ensure the caller's org has its default dashboard with the 4 seed widgets.
 * Returns the dashboard with widgets ordered by `order`.
 */
export async function ensureDefaultDashboard(orgId: string, userId: string) {
  let dashboard = await db.dashboard.findFirst({
    where: { organizationId: orgId, isDefault: true },
    include: { widgets: { orderBy: { order: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  })

  if (!dashboard) {
    dashboard = await db.dashboard.create({
      data: {
        organizationId: orgId,
        name: 'Default dashboard',
        isDefault: true,
        createdById: userId,
        refreshInterval: 300,
        widgets: {
          create: DEFAULT_WIDGET_SEED.map((w, i) => ({
            organizationId: orgId,
            widgetType: w.type,
            title: WIDGET_DEFAULT_TITLES[w.type],
            position: JSON.stringify({ size: 'md' }),
            colorTheme: 'default',
            order: i,
          })),
        },
      },
      include: { widgets: { orderBy: { order: 'asc' } } },
    })
    await audit({
      organizationId: orgId,
      actorId: userId,
      action: 'dashboard.create',
      targetType: 'dashboard',
      targetId: dashboard.id,
      metadata: { seededWidgets: DEFAULT_WIDGET_SEED.length },
    })
    return dashboard
  }

  // Existing default dashboard without widgets (e.g. created empty) — seed it.
  if (dashboard.widgets.length === 0) {
    const dashboardId = dashboard.id
    await db.dashboardWidget.createMany({
      data: DEFAULT_WIDGET_SEED.map((w, i) => ({
        organizationId: orgId,
        dashboardId,
        widgetType: w.type,
        title: WIDGET_DEFAULT_TITLES[w.type],
        position: JSON.stringify({ size: 'md' }),
        colorTheme: 'default',
        order: i,
      })),
    })
    dashboard = await db.dashboard.findFirstOrThrow({
      where: { id: dashboardId },
      include: { widgets: { orderBy: { order: 'asc' } } },
    })
  }

  return dashboard
}

/* ------------------------------------------------------------------ */
/* Legacy dashboard KPI feed (kept for the /api/dashboards/widgets GET) */
/* ------------------------------------------------------------------ */

export async function getDashboardWidgets() {
  const { session, tenant } = await ctx()
  const m = await computeMetrics(tenant.organization.id, session.userId)
  return [
    { type: 'kpi', title: 'Total Revenue', value: m.revenue, format: 'currency', delta: 12.5 },
    { type: 'kpi', title: 'Open Deals', value: m.openDeals, format: 'number', delta: 5.2 },
    { type: 'kpi', title: 'Win Rate', value: m.winRate, format: 'percent', delta: -2.1 },
    { type: 'kpi', title: 'Total Leads', value: m.totalLeads, format: 'number', delta: 8.3 },
    { type: 'kpi', title: 'My Tasks', value: m.myTasks, format: 'number', delta: 0 },
    { type: 'kpi', title: 'Overdue', value: m.overdueTasks, format: 'number', delta: -15 },
    { type: 'kpi', title: 'Upcoming', value: m.upcomingEvents, format: 'number', delta: 3.1 },
    { type: 'kpi', title: 'Calls', value: m.calls, format: 'number', delta: 22 },
    { type: 'kpi', title: 'Emails', value: m.emails, format: 'number', delta: 18.5 },
    { type: 'kpi', title: 'Won', value: m.wonDeals, format: 'number', delta: 10 },
  ]
}

export async function getForecast(periodType = 'monthly') {
  const { tenant } = await ctx()
  const orgId = tenant.organization.id
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const stages = await db.stage.findMany({ where: { organizationId: orgId }, orderBy: { order: 'asc' } })
  const deals = await db.deal.findMany({
    where: { organizationId: orgId, deletedAt: null },
    select: { amount: true, stageId: true, probability: true },
    take: 2000,
  })
  const wonStage = stages.find(s => s.isWonStage)
  const earlyStages = stages.filter(s => !s.isClosed && s.order <= 1).map(s => s.id)
  const midStages = stages.filter(s => !s.isClosed && s.order > 1 && s.order < 4).map(s => s.id)
  const lateStages = stages.filter(s => !s.isClosed && s.order >= 4).map(s => s.id)
  const pipeline = deals.filter(d => earlyStages.includes(d.stageId)).reduce((s, d) => s + d.amount, 0)
  const bestCase = deals.filter(d => midStages.includes(d.stageId)).reduce((s, d) => s + d.amount, 0)
  const commit = deals.filter(d => lateStages.includes(d.stageId) || d.probability >= 75).reduce((s, d) => s + d.amount, 0)
  const closed = deals.filter(d => d.stageId === wonStage?.id).reduce((s, d) => s + d.amount, 0)
  return { periodType, periodStart, periodEnd, categories: [
    { name: 'Pipeline', amount: pipeline, color: '#3b82f6' },
    { name: 'Best Case', amount: bestCase, color: '#8b5cf6' },
    { name: 'Commit', amount: commit, color: '#10b981' },
    { name: 'Closed', amount: closed, color: '#f59e0b' },
  ], total: pipeline + bestCase + commit + closed, scenarios: {
    bestCase: bestCase + commit + closed, worstCase: commit + closed,
    mostLikely: deals.reduce((s, d) => s + d.amount * (d.probability / 100), 0),
  }}
}

export async function getGoals() {
  const { session, tenant } = await ctx()
  const orgId = tenant.organization.id
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  let goals = await db.goal.findMany({ where: { organizationId: orgId, ownerId: session.userId, periodStart, isActive: true }, take: 100 })
  if (goals.length === 0) {
    const defaults = [{ metric: 'revenue', targetAmount: 500000 }, { metric: 'deals_closed', targetAmount: 5 }, { metric: 'calls_made', targetAmount: 100 }, { metric: 'leads_created', targetAmount: 50 }]
    await db.goal.createMany({
      data: defaults.map((g) => ({ organizationId: orgId, ownerType: 'user', ownerId: session.userId, metric: g.metric, periodType: 'monthly', periodStart, periodEnd, targetAmount: g.targetAmount, actualAmount: 0 })),
    })
    goals = await db.goal.findMany({ where: { organizationId: orgId, ownerId: session.userId, periodStart, isActive: true }, take: 100 })
  }
  const [deals, wonDeals, calls, leads] = await Promise.all([
    db.deal.aggregate({ where: { organizationId: orgId, ownerId: session.userId, deletedAt: null }, _sum: { amount: true } }),
    db.deal.count({ where: { organizationId: orgId, ownerId: session.userId, stage: { isWonStage: true } } }),
    db.telephonyCall.count({ where: { organizationId: orgId, ownerId: session.userId } }),
    db.lead.count({ where: { organizationId: orgId, ownerId: session.userId, deletedAt: null } }),
  ])
  const actuals: Record<string, number> = { revenue: deals._sum.amount ?? 0, deals_closed: wonDeals, calls_made: calls, leads_created: leads }
  return goals.map(g => {
    const actual = actuals[g.metric] ?? 0
    const percentage = g.targetAmount > 0 ? (actual / g.targetAmount) * 100 : 0
    return { ...g, actualAmount: actual, percentage, status: percentage >= 100 ? 'exceeded' : percentage >= 75 ? 'on_track' : 'behind' }
  })
}

export async function getLeaderboard() {
  const { tenant } = await ctx()
  // Aggregate per owner in the database (bounded, no full-table scan into memory)
  const groups = await db.deal.groupBy({
    by: ['ownerId'],
    where: { organizationId: tenant.organization.id, deletedAt: null, stage: { isWonStage: true } },
    _sum: { amount: true },
    _count: true,
  })
  // Resolve owner ids to display names so the UI doesn't render raw cuids.
  const ownerIds = [...new Set(groups.map((g) => g.ownerId))]
  const users = ownerIds.length
    ? await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
    : []
  const nameById = new Map(users.map((u) => [u.id, u.name]))
  return groups
    .map((g) => ({ rep: nameById.get(g.ownerId) ?? g.ownerId, revenue: g._sum.amount ?? 0, deals: g._count }))
    .sort((a, b) => b.revenue - a.revenue)
}
