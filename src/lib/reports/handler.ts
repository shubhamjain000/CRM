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

const MODEL_DELEGATES: Record<string, any> = {
  lead: () => db.lead, contact: () => db.contact, account: () => db.account,
  deal: () => db.deal, task: () => db.task, event: () => db.event,
  call: () => db.telephonyCall, activity: () => db.activity,
}

const FIELD_LABELS: Record<string, string> = {
  firstName: 'First Name', lastName: 'Last Name', company: 'Company', email: 'Email',
  leadStatus: 'Status', rating: 'Rating', leadSource: 'Source', industry: 'Industry',
  name: 'Name', amount: 'Amount', stageId: 'Stage', closeDate: 'Close Date',
  probability: 'Probability', type: 'Type', ownerId: 'Owner', createdAt: 'Created',
  annualRevenue: 'Annual Revenue', employees: 'Employees', accountType: 'Account Type',
  priority: 'Priority', dueDate: 'Due Date', title: 'Title', subject: 'Subject',
  outcome: 'Outcome', duration: 'Duration', action: 'Action', score: 'Score',
}

// ---------------------------------------------------------------------------
// Report CRUD
// ---------------------------------------------------------------------------

export async function listReports() {
  const { tenant } = await ctx()
  return db.report.findMany({
    where: { organizationId: tenant.organization.id, isActive: true },
    include: { _count: { select: { executions: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getReport(id: string) {
  const { tenant } = await ctx()
  return db.report.findFirst({
    where: { id, organizationId: tenant.organization.id },
    include: { executions: { orderBy: { startedAt: 'desc' }, take: 10 } },
  })
}

export async function createReport(data: {
  name: string; description?: string; sourceModel?: string; reportType?: string
  fields?: any[]; filters?: Record<string, unknown>; groupBy?: string[]
  aggregates?: any[]; chartType?: string; chartConfig?: Record<string, unknown>
}) {
  const { session, tenant } = await ctx()
  const report = await db.report.create({
    data: {
      organizationId: tenant.organization.id,
      name: data.name,
      description: data.description,
      sourceModel: data.sourceModel ?? 'deal',
      reportType: data.reportType ?? 'tabular',
      fields: JSON.stringify(data.fields ?? []),
      filters: JSON.stringify(data.filters ?? {}),
      groupBy: JSON.stringify(data.groupBy ?? []),
      aggregates: JSON.stringify(data.aggregates ?? []),
      chartType: data.chartType ?? 'none',
      chartConfig: JSON.stringify(data.chartConfig ?? {}),
      createdById: session.userId,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'report.create', targetType: 'report', targetId: report.id,
  })
  return report
}

export async function deleteReport(id: string) {
  const { session, tenant } = await ctx()
  await db.report.deleteMany({ where: { id, organizationId: tenant.organization.id } })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'report.delete', targetType: 'report', targetId: id,
  })
}

export async function updateReport(id: string, data: {
  name?: string; description?: string; sourceModel?: string; reportType?: string
  fields?: any[]; filters?: Record<string, unknown>; groupBy?: string[]
  orderBy?: string[]; aggregates?: any[]; chartType?: string
  chartConfig?: Record<string, unknown>; limit?: number; isActive?: boolean
}) {
  const { session, tenant } = await ctx()
  const existing = await db.report.findFirst({ where: { id, organizationId: tenant.organization.id } })
  if (!existing) throw new Error('Report not found')
  const patch: Record<string, unknown> = {}
  if (typeof data.name === 'string' && data.name.trim()) patch.name = data.name.trim()
  if (data.description !== undefined) patch.description = data.description
  if (data.sourceModel) patch.sourceModel = data.sourceModel
  if (data.reportType) patch.reportType = data.reportType
  if (data.fields !== undefined) patch.fields = JSON.stringify(data.fields)
  if (data.filters !== undefined) patch.filters = JSON.stringify(data.filters)
  if (data.groupBy !== undefined) patch.groupBy = JSON.stringify(data.groupBy)
  if (data.orderBy !== undefined) patch.orderBy = JSON.stringify(data.orderBy)
  if (data.aggregates !== undefined) patch.aggregates = JSON.stringify(data.aggregates)
  if (data.chartType !== undefined) patch.chartType = data.chartType
  if (data.chartConfig !== undefined) patch.chartConfig = JSON.stringify(data.chartConfig)
  if (typeof data.limit === 'number' && data.limit > 0) patch.limit = Math.min(data.limit, 1000)
  if (typeof data.isActive === 'boolean') patch.isActive = data.isActive
  const updated = await db.report.update({ where: { id }, data: patch })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'report.update', targetType: 'report', targetId: id,
    metadata: { fields: Object.keys(patch) },
  })
  return updated
}

// ---------------------------------------------------------------------------
// Execute report
// ---------------------------------------------------------------------------

export async function executeReport(reportId: string) {
  const { session, tenant } = await ctx()
  const report = await db.report.findFirst({
    where: { id: reportId, organizationId: tenant.organization.id },
  })
  if (!report) throw new Error('Report not found')

  const startTime = Date.now()
  const execution = await db.reportExecution.create({
    data: {
      organizationId: tenant.organization.id,
      reportId,
      executedById: session.userId,
      status: 'running',
    },
  })

  try {
    const result = await runQuery(report)
    const executionTimeMs = Date.now() - startTime

    await db.reportExecution.update({
      where: { id: execution.id },
      data: {
        status: 'completed',
        rowCount: result.rows.length,
        executionTimeMs,
        resultData: JSON.stringify(result),
        completedAt: new Date(),
      },
    })
    await db.report.update({
      where: { id: reportId },
      data: { lastRunAt: new Date() },
    })

    return result
  } catch (e) {
    await db.reportExecution.update({
      where: { id: execution.id },
      data: {
        status: 'failed',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
        completedAt: new Date(),
      },
    })
    throw e
  }
}

async function runQuery(report: any) {
  const { tenant } = await ctx()
  const delegate = MODEL_DELEGATES[report.sourceModel]
  if (!delegate) throw new Error(`Unknown source model: ${report.sourceModel}`)

  const fields = JSON.parse(report.fields || '[]') as { field: string; alias?: string }[]
  const filters = JSON.parse(report.filters || '{}')
  const groupBy = JSON.parse(report.groupBy || '[]') as string[]
  const aggregates = JSON.parse(report.aggregates || '[]') as { function: string; field: string; alias?: string }[]
  const orderBy = JSON.parse(report.orderBy || '[]') as string[]
  // Clamp the stored limit so a report can't request unbounded rows
  const limit = Math.min(Number(report.limit ?? 100) || 100, 1000)
  const offset = Number(report.offset ?? 0) || 0

  // Build where clause from filter tree
  const where = buildWhere(filters, tenant.organization.id)

  const orderClauses = orderBy.length > 0
    ? orderBy.reduce((acc, o) => { if (o.startsWith('-')) acc[o.slice(1)] = 'desc'; else acc[o] = 'asc'; return acc }, {} as Record<string, 'asc' | 'desc'>)
    : undefined

  // Branch 1 — GROUP BY (+ optional aggregates): use Prisma groupBy.
  //   groupBy with `by: []` is illegal in Prisma and would 500, so this branch
  //   only fires when at least one group-by column is set.
  if (groupBy.length > 0) {
    // Build the Prisma aggregate object. Each function bucket (_sum, _avg, …)
    // can hold multiple fields; Prisma wants `{ field: true }` not a string.
    const prismaAgg: Record<string, unknown> = {}
    const byFn: Record<string, string[]> = { sum: [], avg: [], min: [], max: [] }
    for (const agg of aggregates) {
      if (agg.function === 'count') prismaAgg._count = true
      else if (byFn[agg.function]) {
        if (agg.field) byFn[agg.function].push(agg.field)
      }
    }
    for (const fn of Object.keys(byFn)) {
      if (byFn[fn].length > 0) prismaAgg[`_${fn}`] = Object.fromEntries(byFn[fn].map((f) => [f, true]))
    }

    // Prisma groupBy requires every orderBy field to be in `by`. If the user
    // didn't pick an orderBy, default to the first group-by column so the
    // result is deterministic; otherwise filter to only valid (in-by) clauses.
    let groupOrderBy: Record<string, 'asc' | 'desc'> | undefined
    if (orderClauses) {
      const valid: Record<string, 'asc' | 'desc'> = {}
      for (const [k, v] of Object.entries(orderClauses)) {
        if (groupBy.includes(k)) valid[k] = v as 'asc' | 'desc'
      }
      if (Object.keys(valid).length > 0) groupOrderBy = valid
    }
    if (!groupOrderBy) groupOrderBy = { [groupBy[0]]: 'asc' }

    const results = await delegate().groupBy({
      by: groupBy,
      where,
      ...prismaAgg,
      orderBy: groupOrderBy,
      take: limit,
    })

    // Prisma returns aggregate results nested under _count/_sum/… keys; flatten
    // them so the columns the user configured (count_X, sum_Y) line up with the
    // row values.
    const flatRows = (results as Record<string, unknown>[]).map((r) => {
      const flat: Record<string, unknown> = {}
      for (const gb of groupBy) flat[gb] = r[gb]
      for (const agg of aggregates) {
        const key = agg.alias || `${agg.function}_${agg.field}`
        if (agg.function === 'count') {
          flat[key] = (r._count as number | undefined) ?? 0
        } else {
          const bucket = r[`_${agg.function}`] as Record<string, unknown> | undefined
          flat[key] = bucket?.[agg.field] ?? null
        }
      }
      return flat
    })

    const columns = [
      ...groupBy.map(g => ({ field: g, label: FIELD_LABELS[g] ?? g })),
      ...aggregates.map(a => ({ field: a.alias || `${a.function}_${a.field}`, label: a.alias || `${a.function}(${a.field})` })),
    ]
    return { columns, rows: flatRows, total: flatRows.length, chartData: generateChartData(report.chartType, flatRows, groupBy, aggregates) }
  }

  // Branch 2 — AGGREGATE-ONLY (no group by): a single rolled-up row.
  //   Prisma's `aggregate()` is the right call here (groupBy would crash with
  //   an empty `by` array). We emit one row whose columns are the aggregates.
  if (aggregates.length > 0) {
    const aggInput: Record<string, unknown> = {}
    const byFn: Record<string, string[]> = { sum: [], avg: [], min: [], max: [] }
    for (const agg of aggregates) {
      if (agg.function === 'count') aggInput._count = true
      else if (byFn[agg.function] && agg.field) byFn[agg.function].push(agg.field)
    }
    for (const fn of Object.keys(byFn)) {
      if (byFn[fn].length > 0) aggInput[`_${fn}`] = Object.fromEntries(byFn[fn].map((f) => [f, true]))
    }
    const raw = await delegate().aggregate({ where, ...aggInput }) as Record<string, unknown>
    const flat: Record<string, unknown> = {}
    for (const agg of aggregates) {
      const key = agg.alias || `${agg.function}_${agg.field}`
      if (agg.function === 'count') flat[key] = raw._count ?? 0
      else {
        const bucket = raw[`_${agg.function}`] as Record<string, unknown> | undefined
        flat[key] = bucket?.[agg.field] ?? null
      }
    }
    const columns = aggregates.map(a => ({ field: a.alias || `${a.function}_${a.field}`, label: a.alias || `${a.function}(${a.field})` }))
    const rows = [flat]
    return { columns, rows, total: 1, chartData: generateChartData(report.chartType, rows, [], aggregates) }
  }

  // Branch 3 — plain tabular query (no grouping, no aggregates).
  const selectFields = fields.length > 0 ? fields.reduce((acc, f) => { acc[f.field] = true; return acc }, {} as Record<string, boolean>) : undefined
  const results = await delegate().findMany({
    where,
    select: selectFields ?? undefined,
    orderBy: orderClauses ?? { createdAt: 'desc' },
    take: limit,
    skip: offset,
  })

  const columns = fields.length > 0 ? fields.map(f => ({ field: f.alias || f.field, label: f.alias || (FIELD_LABELS[f.field] ?? f.field) })) : Object.keys(results[0] ?? {}).map(k => ({ field: k, label: FIELD_LABELS[k] ?? k }))
  return { columns, rows: results as Record<string, unknown>[], total: results.length, chartData: generateChartData(report.chartType, results, [], []) }
}

function buildWhere(filters: Record<string, unknown>, orgId: string): Record<string, unknown> {
  const where: Record<string, unknown> = { organizationId: orgId, deletedAt: null }
  if (!filters || Object.keys(filters).length === 0) return where

  const applyNode = (node: Record<string, unknown>): Record<string, unknown> | undefined => {
    if (node.AND) return { AND: (node.AND as any[]).map(applyNode).filter(Boolean) }
    if (node.OR) return { OR: (node.OR as any[]).map(applyNode).filter(Boolean) }
    if (node.field && node.op) {
      const { field, op, value } = node as { field: string; op: string; value: unknown }
      switch (op) {
        case 'eq': return { [field]: value }
        case 'ne': return { [field]: { not: value } }
        case 'contains': return { [field]: { contains: value } }
        case 'startswith': return { [field]: { startsWith: value } }
        case 'endswith': return { [field]: { endsWith: value } }
        case 'isnull': return { [field]: null }
        case 'isnotnull': return { [field]: { not: null } }
        case 'gt': return { [field]: { gt: value } }
        case 'lt': return { [field]: { lt: value } }
        case 'gte': return { [field]: { gte: value } }
        case 'lte': return { [field]: { lte: value } }
        case 'in': return { [field]: { in: value } }
        default: return undefined
      }
    }
    return undefined
  }

  const filterWhere = applyNode(filters)
  if (filterWhere) Object.assign(where, filterWhere)
  return where
}

/** True when a row value can be plotted as a chart value. */
function isChartNumeric(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'bigint') return true
  if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v))
  return false
}

/** First plottable column other than the label column (fallback: any other column, then the first). */
function pickNumericField(row: Record<string, unknown>, exclude: string): string | undefined {
  const keys = Object.keys(row)
  return (
    keys.find((k) => k !== exclude && isChartNumeric(row[k])) ??
    keys.find((k) => k !== exclude) ??
    keys[0]
  )
}

function generateChartData(chartType: string, rows: Record<string, unknown>[], groupBy: string[], aggregates: { function: string; field: string; alias?: string }[]) {
  if (chartType === 'none' || rows.length === 0) return null

  const firstRow = rows[0]
  const keys = Object.keys(firstRow)
  if (keys.length === 0) return null

  // Label column: prefer the first group-by field. Rows are already flat
  // (Prisma groupBy rows are flattened upstream), so there is no column
  // prefix to strip — fall back to the first row key.
  const labelField = groupBy.length > 0 && keys.includes(groupBy[0]) ? groupBy[0] : keys[0]

  // Value column: the `alias || `${fn}_${field}`` template is only meaningful
  // when an aggregate is configured. The old expression built the always-truthy
  // string "undefined_undefined" when aggregates was empty, so the numeric
  // fallback never ran and every chart rendered with zero values.
  let valueField: string | undefined
  if (aggregates.length > 0) {
    const agg = aggregates[0]
    const aggKey = agg.alias || `${agg.function}_${agg.field}`
    valueField = keys.includes(aggKey) ? aggKey : pickNumericField(firstRow, labelField)
  } else {
    valueField = pickNumericField(firstRow, labelField)
  }
  if (!valueField) return null

  if (chartType === 'pie' || chartType === 'donut') {
    return {
      labels: rows.map(r => String(r[labelField] ?? '—')),
      datasets: [{ data: rows.map(r => Number(r[valueField] ?? 0)) }],
    }
  }
  if (chartType === 'funnel') {
    return {
      stages: rows.map(r => String(r[labelField] ?? '—')),
      values: rows.map(r => Number(r[valueField] ?? 0)),
    }
  }
  // bar, line, area
  return {
    labels: rows.map(r => String(r[labelField] ?? '—')),
    datasets: [{
      label: FIELD_LABELS[valueField] ?? valueField,
      data: rows.map(r => Number(r[valueField] ?? 0)),
    }],
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportReport(reportId: string, format: 'csv' | 'json' = 'csv') {
  const result = await executeReport(reportId)
  if (format === 'json') return JSON.stringify(result, null, 2)

  const headers = result.columns.map(c => c.label)
  const csvRows = [headers.join(',')]
  for (const row of result.rows) {
    csvRows.push(result.columns.map(c => {
      const val = row[c.field]
      if (val === null || val === undefined) return ''
      if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`
      return `"${String(val).replace(/"/g, '""')}"`
    }).join(','))
  }
  return csvRows.join('\n')
}

// ---------------------------------------------------------------------------
// Pre-built analytics
// ---------------------------------------------------------------------------

export async function getSalesFunnel() {
  const { tenant } = await ctx()
  const orgId = tenant.organization.id
  const [leads, contacts, deals, wonDeals] = await Promise.all([
    db.lead.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.contact.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.deal.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.deal.count({ where: { organizationId: orgId, deletedAt: null, stage: { isWonStage: true } } }),
  ])
  return {
    stages: ['Leads', 'Contacts', 'Deals', 'Won'],
    values: [leads, contacts, deals, wonDeals],
    conversionRates: [
      { from: 'Leads', to: 'Contacts', rate: leads > 0 ? (contacts / leads) * 100 : 0 },
      { from: 'Contacts', to: 'Deals', rate: contacts > 0 ? (deals / contacts) * 100 : 0 },
      { from: 'Deals', to: 'Won', rate: deals > 0 ? (wonDeals / deals) * 100 : 0 },
    ],
  }
}

export async function getWinLossAnalysis() {
  const { tenant } = await ctx()
  const orgId = tenant.organization.id
  const wonStage = await db.stage.findFirst({ where: { organizationId: orgId, isWonStage: true } })
  const lostStage = await db.stage.findFirst({ where: { organizationId: orgId, isLostStage: true } })
  const [won, lost] = await Promise.all([
    db.deal.count({ where: { organizationId: orgId, stageId: wonStage?.id ?? '' } }),
    db.deal.count({ where: { organizationId: orgId, stageId: lostStage?.id ?? '' } }),
  ])
  const bySource = await db.deal.groupBy({
    by: ['leadSource'], where: { organizationId: orgId, deletedAt: null },
    _count: true, orderBy: { _count: { leadSource: 'desc' } },
  })
  return {
    won, lost, winRate: won + lost > 0 ? (won / (won + lost)) * 100 : 0,
    bySource: bySource.map(s => ({ source: s.leadSource ?? 'Unknown', count: s._count })),
  }
}

export async function getRepPerformance() {
  const { tenant } = await ctx()
  const orgId = tenant.organization.id
  const deals = await db.deal.findMany({
    where: { organizationId: orgId, deletedAt: null },
    select: { ownerId: true, amount: true, stage: { select: { isWonStage: true } } },
  })
  const byRep: Record<string, { deals: number; revenue: number; won: number }> = {}
  for (const d of deals) {
    if (!byRep[d.ownerId]) byRep[d.ownerId] = { deals: 0, revenue: 0, won: 0 }
    byRep[d.ownerId].deals++
    byRep[d.ownerId].revenue += d.amount
    if (d.stage?.isWonStage) byRep[d.ownerId].won++
  }
  return Object.entries(byRep).map(([rep, data]) => ({
    rep, deals: data.deals, revenue: data.revenue, won: data.won,
    winRate: data.deals > 0 ? (data.won / data.deals) * 100 : 0,
  })).sort((a, b) => b.revenue - a.revenue)
}

export async function getPipelineVelocity() {
  const { tenant } = await ctx()
  const stages = await db.stage.findMany({
    where: { organizationId: tenant.organization.id },
    orderBy: { order: 'asc' }, select: { id: true, name: true, color: true },
  })
  const history = await db.dealStageHistory.findMany({
    where: { organizationId: tenant.organization.id },
    select: { toStageId: true, durationInPreviousStage: true },
  })
  return stages.map(s => {
    const entries = history.filter(h => h.toStageId === s.id)
    const avgSeconds = entries.length > 0 ? entries.reduce((sum, h) => sum + h.durationInPreviousStage, 0) / entries.length : 0
    return { stageId: s.id, stageName: s.name, color: s.color, avgDays: Math.round(avgSeconds / 86400 * 10) / 10, count: entries.length }
  })
}

export async function getActivityHeatmap() {
  const { tenant } = await ctx()
  const activities = await db.activity.findMany({
    where: { organizationId: tenant.organization.id },
    select: { createdAt: true },
    take: 5000,
  })
  // 7 days × 24 hours
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const a of activities) {
    const day = a.createdAt.getDay()
    const hour = a.createdAt.getHours()
    heatmap[day][hour]++
  }
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return { days, hours: Array.from({ length: 24 }, (_, i) => `${i}:00`), data: heatmap }
}

export async function getSourceROI() {
  const { tenant } = await ctx()
  const orgId = tenant.organization.id
  const wonStage = await db.stage.findFirst({ where: { organizationId: orgId, isWonStage: true } })
  const bySource = await db.deal.groupBy({
    by: ['leadSource'], where: { organizationId: orgId, deletedAt: null },
    _count: true, _sum: { amount: true },
  })
  const wonBySource = await db.deal.groupBy({
    by: ['leadSource'], where: { organizationId: orgId, stageId: wonStage?.id ?? '' },
    _count: true, _sum: { amount: true },
  })
  return bySource.map(s => {
    const won = wonBySource.find(w => w.leadSource === s.leadSource)
    return {
      source: s.leadSource ?? 'Unknown',
      totalDeals: s._count,
      totalRevenue: s._sum.amount ?? 0,
      wonDeals: won?._count ?? 0,
      wonRevenue: won?._sum.amount ?? 0,
    }
  }).sort((a, b) => b.totalRevenue - a.totalRevenue)
}

export async function getDealDistribution() {
  const { tenant } = await ctx()
  const deals = await db.deal.findMany({
    where: { organizationId: tenant.organization.id, deletedAt: null },
    select: { amount: true },
  })
  // Create histogram buckets (INR scale: lakh / crore)
  const buckets = [0, 100000, 500000, 1000000, 2500000, 5000000, 10000000, 50000000]
  const labels = ['<₹1L', '₹1-5L', '₹5-10L', '₹10-25L', '₹25-50L', '₹50L-1Cr', '₹1-5Cr', '₹5Cr+']
  const counts = new Array(buckets.length).fill(0)
  for (const d of deals) {
    if (d.amount == null) continue // null amounts would all pile into the lowest bucket
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (d.amount >= buckets[i]) { counts[i]++; break }
    }
  }
  return { labels, values: counts }
}
