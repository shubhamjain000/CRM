import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { hasPermission } from '@/lib/auth/permissions'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

// ---------------------------------------------------------------------------
// Pipeline + Stage CRUD
// ---------------------------------------------------------------------------

export async function listPipelines() {
  const { tenant } = await ctx()
  return db.pipeline.findMany({
    where: { organizationId: tenant.organization.id, isActive: true },
    include: { stages: { orderBy: { order: 'asc' } }, _count: { select: { deals: { where: { deletedAt: null } } } } },
    orderBy: { order: 'asc' },
  })
}

export async function createPipeline(data: { name: string; isDefault?: boolean }) {
  const { session, tenant } = await ctx()
  const pipeline = await db.pipeline.create({
    data: {
      organizationId: tenant.organization.id,
      name: data.name,
      isDefault: data.isDefault ?? false,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'pipeline.create', targetType: 'pipeline', targetId: pipeline.id,
  })
  return pipeline
}

export async function updatePipeline(id: string, data: { name?: string; isDefault?: boolean; isActive?: boolean }) {
  const { session, tenant } = await ctx()
  await db.pipeline.updateMany({ where: { id, organizationId: tenant.organization.id }, data })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'pipeline.update', targetType: 'pipeline', targetId: id,
  })
}

export async function deletePipeline(id: string) {
  const { session, tenant } = await ctx()
  // Don't allow deleting the default pipeline
  const pipeline = await db.pipeline.findFirst({ where: { id, organizationId: tenant.organization.id } })
  if (!pipeline) throw new Error('Not found')
  if (pipeline.isDefault) throw new Error('Cannot delete the default pipeline')
  await db.pipeline.delete({ where: { id } })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'pipeline.delete', targetType: 'pipeline', targetId: id,
  })
}

// ---------------------------------------------------------------------------
// Stage CRUD + reorder
// ---------------------------------------------------------------------------

export async function createStage(pipelineId: string, data: {
  name: string; probability?: number; isWonStage?: boolean; isLostStage?: boolean
  businessDaysLimit?: number; color?: string; forecastCategory?: string
}) {
  const { session, tenant } = await ctx()
  const pipeline = await db.pipeline.findFirst({ where: { id: pipelineId, organizationId: tenant.organization.id } })
  if (!pipeline) throw new Error('Pipeline not found')

  const lastOrder = await db.stage.findFirst({
    where: { pipelineId }, orderBy: { order: 'desc' }, select: { order: true },
  })
  const stage = await db.stage.create({
    data: {
      organizationId: tenant.organization.id,
      pipelineId,
      name: data.name,
      probability: data.probability ?? 0,
      isWonStage: data.isWonStage ?? false,
      isLostStage: data.isLostStage ?? false,
      isClosed: (data.isWonStage ?? false) || (data.isLostStage ?? false),
      businessDaysLimit: data.businessDaysLimit,
      color: data.color ?? '#3b82f6',
      forecastCategory: data.forecastCategory ?? 'pipeline',
      order: (lastOrder?.order ?? -1) + 1,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'stage.create', targetType: 'stage', targetId: stage.id,
  })
  return stage
}

export async function updateStage(stageId: string, data: {
  name?: string; probability?: number; isWonStage?: boolean; isLostStage?: boolean
  isLocked?: boolean; businessDaysLimit?: number; color?: string; forecastCategory?: string
}) {
  const { session, tenant } = await ctx()
  const updateData: Record<string, unknown> = { ...data }
  if (data.isWonStage !== undefined || data.isLostStage !== undefined) {
    updateData.isClosed = (data.isWonStage ?? false) || (data.isLostStage ?? false)
  }
  await db.stage.updateMany({ where: { id: stageId, organizationId: tenant.organization.id }, data: updateData })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'stage.update', targetType: 'stage', targetId: stageId,
  })
}

export async function reorderStages(pipelineId: string, stageIds: string[]) {
  const { session, tenant } = await ctx()
  // Verify all stages belong to this pipeline + tenant
  const stages = await db.stage.findMany({
    where: { pipelineId, organizationId: tenant.organization.id },
    select: { id: true },
  })
  const validIds = new Set(stages.map((s) => s.id))
  if (!stageIds.every((id) => validIds.has(id))) throw new Error('Invalid stage IDs')

  for (let i = 0; i < stageIds.length; i++) {
    await db.stage.updateMany({ where: { id: stageIds[i] }, data: { order: i } })
  }
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'stage.reorder', targetType: 'pipeline', targetId: pipelineId,
  })
}

// ---------------------------------------------------------------------------
// Transition engine
// ---------------------------------------------------------------------------

export interface TransitionResult {
  ok: boolean
  error?: string
  deal?: unknown
}

/**
 * Validate + execute a deal stage transition.
 * - Checks: deal exists, target stage exists in same pipeline, stage not locked
 * - If StageTransition rules exist for this pipeline, validates against them
 * - Logs DealStageHistory with duration_in_previous_stage
 * - Updates deal.forecastCategory from target stage
 */
export async function transitionDeal(
  dealId: string,
  toStageId: string,
  reason?: string,
): Promise<TransitionResult> {
  const { session, tenant } = await ctx()
  const deal = await db.deal.findFirst({
    where: { id: dealId, organizationId: tenant.organization.id, deletedAt: null },
    include: { stage: true },
  })
  if (!deal) return { ok: false, error: 'Deal not found' }

  const toStage = await db.stage.findFirst({
    where: { id: toStageId, organizationId: tenant.organization.id, pipelineId: deal.pipelineId },
  })
  if (!toStage) return { ok: false, error: 'Target stage not found in this pipeline' }

  // Can't move out of a locked stage (won/lost)
  if (deal.stage.isLocked) {
    return { ok: false, error: `Stage "${deal.stage.name}" is locked — deals cannot be moved out` }
  }

  // Check transition rules (if any exist for this pipeline)
  const transitions = await db.stageTransition.findMany({
    where: { pipelineId: deal.pipelineId },
  })
  if (transitions.length > 0) {
    const allowed = transitions.find(
      (t) => t.fromStageId === deal.stageId && t.toStageId === toStageId,
    )
    if (!allowed) {
      return { ok: false, error: 'Transition not allowed by pipeline rules' }
    }
    // Check role permissions (empty allowedRoles = all roles)
    const allowedRoles = JSON.parse(allowed.allowedRoles || '[]') as string[]
    if (allowedRoles.length > 0) {
      const canTransition = await hasPermission(tenant.role.id, 'deals.manage') ||
        allowedRoles.includes(tenant.role.name)
      if (!canTransition) {
        return { ok: false, error: `Your role (${tenant.role.name}) cannot make this transition` }
      }
    }
    // Check conditions (min_amount, max_amount)
    const conditions = JSON.parse(allowed.conditions || '{}') as Record<string, number>
    if (conditions.min_amount && deal.amount < conditions.min_amount) {
      return { ok: false, error: `Deal amount must be at least ${conditions.min_amount}` }
    }
    if (conditions.max_amount && deal.amount > conditions.max_amount) {
      return { ok: false, error: `Deal amount must be at most ${conditions.max_amount}` }
    }
  }

  // Calculate duration in previous stage
  const lastHistory = await db.dealStageHistory.findFirst({
    where: { dealId }, orderBy: { changedAt: 'desc' }, select: { changedAt: true },
  })
  const duration = lastHistory
    ? Math.floor((Date.now() - lastHistory.changedAt.getTime()) / 1000)
    : Math.floor((Date.now() - deal.createdAt.getTime()) / 1000)

  // Execute transition
  const updated = await db.deal.update({
    where: { id: dealId },
    data: {
      stageId: toStageId,
      probability: toStage.probability,
      forecastCategory: toStage.forecastCategory,
    },
  })

  // Log history
  await db.dealStageHistory.create({
    data: {
      organizationId: tenant.organization.id,
      dealId,
      fromStageId: deal.stageId,
      toStageId,
      changedById: session.userId,
      reason,
      durationInPreviousStage: duration,
    },
  })

  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'deal.transition', targetType: 'deal', targetId: dealId,
    metadata: { fromStage: deal.stage.name, toStage: toStage.name, reason },
  })

  return { ok: true, deal: updated }
}

/**
 * Get available transitions for a deal (based on StageTransition rules).
 * If no rules exist, all stages in the pipeline are available (except locked source).
 */
export async function getAvailableTransitions(dealId: string) {
  const { tenant } = await ctx()
  const deal = await db.deal.findFirst({
    where: { id: dealId, organizationId: tenant.organization.id },
    include: { stage: true },
  })
  if (!deal) throw new Error('Deal not found')

  const allStages = await db.stage.findMany({
    where: { pipelineId: deal.pipelineId, organizationId: tenant.organization.id },
    orderBy: { order: 'asc' },
  })
  const transitions = await db.stageTransition.findMany({
    where: { pipelineId: deal.pipelineId, fromStageId: deal.stageId },
  })

  if (transitions.length === 0) {
    // No rules → all stages available (except current if locked)
    return allStages.filter((s) => !deal.stage.isLocked || s.id !== deal.stageId)
  }
  // Only allowed target stages
  const allowedIds = new Set(transitions.map((t) => t.toStageId))
  return allStages.filter((s) => allowedIds.has(s.id))
}

/**
 * Check if a deal is stuck in its current stage.
 */
export async function checkStageLimits(dealId: string) {
  const { tenant } = await ctx()
  const deal = await db.deal.findFirst({
    where: { id: dealId, organizationId: tenant.organization.id },
    include: { stage: true },
  })
  if (!deal || !deal.stage.businessDaysLimit) return { stuck: false, daysInStage: 0, limit: null }

  const lastHistory = await db.dealStageHistory.findFirst({
    where: { dealId, toStageId: deal.stageId },
    orderBy: { changedAt: 'desc' },
    select: { changedAt: true },
  })
  const since = lastHistory?.changedAt ?? deal.createdAt
  const daysInStage = Math.floor((Date.now() - since.getTime()) / 86400000)
  return {
    stuck: daysInStage > deal.stage.businessDaysLimit,
    daysInStage,
    limit: deal.stage.businessDaysLimit,
  }
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export async function getPipelineMetrics(pipelineId: string) {
  const { tenant } = await ctx()
  const stages = await db.stage.findMany({
    where: { pipelineId, organizationId: tenant.organization.id },
    orderBy: { order: 'asc' },
  })
  const deals = await db.deal.findMany({
    where: { pipelineId, organizationId: tenant.organization.id, deletedAt: null },
    select: { id: true, amount: true, stageId: true, probability: true, createdAt: true },
    take: 1000,
  })

  const stageMetrics = stages.map((stage) => {
    const stageDeals = deals.filter((d) => d.stageId === stage.id)
    const sumAmount = stageDeals.reduce((s, d) => s + (d.amount || 0), 0)
    const weightedValue = stageDeals.reduce((s, d) => s + (d.amount || 0) * (stage.probability / 100), 0)
    return {
      stageId: stage.id,
      stageName: stage.name,
      count: stageDeals.length,
      sumAmount,
      weightedValue,
      probability: stage.probability,
      forecastCategory: stage.forecastCategory,
      color: stage.color,
    }
  })

  const totalAmount = deals.reduce((s, d) => s + (d.amount || 0), 0)
  const totalWeighted = stageMetrics.reduce((s, m) => s + m.weightedValue, 0)
  const wonStage = stages.find((s) => s.isWonStage)
  const lostStage = stages.find((s) => s.isLostStage)
  const wonCount = wonStage ? deals.filter((d) => d.stageId === wonStage.id).length : 0
  const lostCount = lostStage ? deals.filter((d) => d.stageId === lostStage.id).length : 0
  const winRate = wonCount + lostCount > 0 ? (wonCount / (wonCount + lostCount)) * 100 : 0

  return {
    stages: stageMetrics,
    totalDeals: deals.length,
    totalAmount,
    totalWeighted,
    winRate,
    wonCount,
    lostCount,
  }
}

export async function getDealVelocity(pipelineId: string) {
  const { tenant } = await ctx()
  const stages = await db.stage.findMany({
    where: { pipelineId, organizationId: tenant.organization.id },
    orderBy: { order: 'asc' },
    select: { id: true, name: true, color: true },
  })
  const history = await db.dealStageHistory.findMany({
    where: { organizationId: tenant.organization.id, deal: { pipelineId } },
    select: { toStageId: true, durationInPreviousStage: true },
    orderBy: { changedAt: 'desc' },
    take: 2000,
  })

  return stages.map((stage) => {
    const entries = history.filter((h) => h.toStageId === stage.id)
    const avgSeconds = entries.length > 0
      ? entries.reduce((s, h) => s + h.durationInPreviousStage, 0) / entries.length
      : 0
    return {
      stageId: stage.id,
      stageName: stage.name,
      color: stage.color,
      avgDays: Math.round(avgSeconds / 86400 * 10) / 10,
      count: entries.length,
    }
  })
}

export async function getAtRiskDeals() {
  const { tenant } = await ctx()
  // Single query: only open deals (closed stages can't be at-risk)
  const deals = await db.deal.findMany({
    where: { organizationId: tenant.organization.id, deletedAt: null, stage: { isClosed: false } },
    include: { stage: true },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })
  // One grouped query for each deal's latest stage-entry time (replaces per-deal N+1)
  const lastEntries = await db.dealStageHistory.groupBy({
    by: ['dealId'],
    where: { organizationId: tenant.organization.id, dealId: { in: deals.map((d) => d.id) } },
    _max: { changedAt: true },
  })
  const lastEntryMap = new Map(lastEntries.map((e) => [e.dealId, e._max.changedAt]))

  const atRisk: { id: string; name: string; amount: number; reason: string; daysInStage: number; closeDate: string | null; stageName: string }[] = []

  for (const deal of deals) {
    // Check if stuck in stage
    if (deal.stage.businessDaysLimit) {
      const since = lastEntryMap.get(deal.id) ?? deal.createdAt
      const daysInStage = Math.floor((Date.now() - since.getTime()) / 86400000)
      if (daysInStage > deal.stage.businessDaysLimit) {
        atRisk.push({
          id: deal.id, name: deal.name, amount: deal.amount,
          reason: `Stuck in "${deal.stage.name}" for ${daysInStage} days (limit: ${deal.stage.businessDaysLimit})`,
          daysInStage, closeDate: deal.closeDate?.toISOString() ?? null,
          stageName: deal.stage.name,
        })
      }
    }
    // Check if close date passed but still open
    if (deal.closeDate && deal.closeDate < new Date()) {
      atRisk.push({
        id: deal.id, name: deal.name, amount: deal.amount,
        reason: 'Close date passed but deal still open',
        daysInStage: 0, closeDate: deal.closeDate.toISOString(), stageName: deal.stage.name,
      })
    }
  }
  return atRisk
}

export async function getMyDeals() {
  const { session, tenant } = await ctx()
  return db.deal.findMany({
    where: { organizationId: tenant.organization.id, ownerId: session.userId, deletedAt: null },
    include: { stage: { select: { name: true, color: true, isWonStage: true, isLostStage: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
}
