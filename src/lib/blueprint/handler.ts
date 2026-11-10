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
// Blueprint CRUD
// ---------------------------------------------------------------------------

export async function listBlueprints() {
  const { tenant } = await ctx()
  return db.blueprint.findMany({
    where: { organizationId: tenant.organization.id },
    include: {
      pipeline: { select: { name: true } },
      _count: { select: { executions: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getBlueprint(id: string) {
  const { tenant } = await ctx()
  return db.blueprint.findFirst({
    where: { id, organizationId: tenant.organization.id },
    include: {
      states: { include: { stage: true, timers: true } },
      transitions: {
        include: {
          fromState: { include: { stage: true } },
          toState: { include: { stage: true } },
          fieldRequirements: true,
          assignments: true,
        },
      },
      pipeline: { include: { stages: { orderBy: { order: 'asc' } } } },
    },
  })
}

export async function createBlueprint(data: {
  name: string; pipelineId: string; description?: string
}) {
  const { session, tenant } = await ctx()
  const blueprint = await db.blueprint.create({
    data: {
      organizationId: tenant.organization.id,
      name: data.name,
      pipelineId: data.pipelineId,
      description: data.description,
    },
  })
  // Auto-create states for all existing stages in the pipeline
  const stages = await db.stage.findMany({
    where: { pipelineId: data.pipelineId, organizationId: tenant.organization.id },
    orderBy: { order: 'asc' },
  })
  for (const stage of stages) {
    const stateType = stage.isWonStage || stage.isLostStage ? 'terminal' : 'normal'
    await db.blueprintState.create({
      data: {
        organizationId: tenant.organization.id,
        blueprintId: blueprint.id,
        stageId: stage.id,
        stateType,
      },
    })
  }
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'blueprint.create', targetType: 'blueprint', targetId: blueprint.id,
  })
  return blueprint
}

export async function publishBlueprint(id: string) {
  const { session, tenant } = await ctx()
  // Deactivate other active blueprints for this pipeline
  const bp = await db.blueprint.findFirst({ where: { id, organizationId: tenant.organization.id } })
  if (!bp) throw new Error('Not found')
  await db.blueprint.updateMany({
    where: { pipelineId: bp.pipelineId, organizationId: tenant.organization.id, id: { not: id } },
    data: { isActive: false },
  })
  await db.blueprint.update({ where: { id }, data: { isActive: true, isPublished: true } })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'blueprint.publish', targetType: 'blueprint', targetId: id,
  })
}

// ---------------------------------------------------------------------------
// State + Transition configuration
// ---------------------------------------------------------------------------

export async function updateState(stateId: string, data: {
  stateType?: string; entryActions?: string; exitActions?: string; timeLimitHours?: number | null
}) {
  const { tenant } = await ctx()
  await db.blueprintState.updateMany({
    where: { id: stateId, organizationId: tenant.organization.id },
    data,
  })
}

export async function createTransition(data: {
  blueprintId: string; fromStateId: string; toStateId: string
  allowedRoles?: string[]; requireFields?: string[]; requireApproval?: boolean
  conditions?: Record<string, unknown>
}) {
  const { session, tenant } = await ctx()
  // Verify the blueprint belongs to this tenant (prevents cross-org injection)
  const blueprint = await db.blueprint.findFirst({
    where: { id: data.blueprintId, organizationId: tenant.organization.id },
    select: { id: true },
  })
  if (!blueprint) throw new Error('Blueprint not found')
  return db.blueprintTransition.create({
    data: {
      organizationId: tenant.organization.id,
      blueprintId: data.blueprintId,
      fromStateId: data.fromStateId,
      toStateId: data.toStateId,
      allowedRoles: JSON.stringify(data.allowedRoles ?? []),
      requireFields: JSON.stringify(data.requireFields ?? []),
      requireApproval: data.requireApproval ?? false,
      conditions: JSON.stringify(data.conditions ?? {}),
    },
  })
}

export async function deleteTransition(id: string) {
  const { tenant } = await ctx()
  await db.blueprintTransition.deleteMany({
    where: { id, organizationId: tenant.organization.id },
  })
}

// ---------------------------------------------------------------------------
// Execution engine
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean
  errors: string[]
  missingFields: string[]
  requiresApproval: boolean
}

/**
 * Validate a deal transition against the blueprint rules.
 */
export async function validateTransition(
  dealId: string,
  toStateId: string,
): Promise<ValidationResult> {
  const { session, tenant } = await ctx()
  const execution = await db.blueprintExecution.findFirst({
    where: { dealId, organizationId: tenant.organization.id },
    include: { blueprint: true, currentState: true },
  })
  if (!execution) return { valid: true, errors: [], missingFields: [], requiresApproval: false }
  if (!execution.currentStateId) return { valid: true, errors: [], missingFields: [], requiresApproval: false }

  const transition = await db.blueprintTransition.findFirst({
    where: {
      blueprintId: execution.blueprintId,
      fromStateId: execution.currentStateId,
      toStateId,
      organizationId: tenant.organization.id,
    },
    include: { fieldRequirements: true },
  })

  if (!transition) {
    return { valid: false, errors: ['No transition defined from current state to target state'], missingFields: [], requiresApproval: false }
  }

  const errors: string[] = []
  const missingFields: string[] = []

  // Check role permissions
  const allowedRoles = JSON.parse(transition.allowedRoles || '[]') as string[]
  if (allowedRoles.length > 0) {
    const canTransition = await hasPermission(tenant.role.id, 'blueprints.manage') ||
      allowedRoles.includes(tenant.role.name)
    if (!canTransition) {
      errors.push(`Your role (${tenant.role.name}) cannot make this transition. Allowed: ${allowedRoles.join(', ')}`)
    }
  }

  // Check field requirements
  const deal = await db.deal.findFirst({ where: { id: dealId } })
  if (deal) {
    for (const req of transition.fieldRequirements) {
      const value = (deal as Record<string, unknown>)[req.fieldName]
      if (req.condition === 'not_empty' && (!value || value === '')) {
        missingFields.push(req.fieldName)
      }
    }
    if (missingFields.length > 0) {
      errors.push(`Missing required fields: ${missingFields.join(', ')}`)
    }
  }

  // Check conditions (field expressions)
  const conditions = JSON.parse(transition.conditions || '{}') as Record<string, { $gt?: number; $lt?: number }>
  for (const [field, ops] of Object.entries(conditions)) {
    const dealValue = deal ? (deal as Record<string, unknown>)[field] : undefined
    if (ops.$gt !== undefined && (typeof dealValue !== 'number' || dealValue <= ops.$gt)) {
      errors.push(`${field} must be greater than ${ops.$gt}`)
    }
    if (ops.$lt !== undefined && (typeof dealValue !== 'number' || dealValue >= ops.$lt)) {
      errors.push(`${field} must be less than ${ops.$lt}`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingFields,
    requiresApproval: transition.requireApproval,
  }
}

/**
 * Execute a deal transition through the blueprint.
 */
export async function executeTransition(
  dealId: string,
  toStateId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { session, tenant } = await ctx()
  const validation = await validateTransition(dealId, toStateId)
  if (!validation.valid) {
    return { ok: false, error: validation.errors.join('; ') }
  }

  const execution = await db.blueprintExecution.findFirst({
    where: { dealId, organizationId: tenant.organization.id },
  })
  if (!execution) return { ok: false, error: 'No blueprint execution for this deal' }

  const toState = await db.blueprintState.findFirst({
    where: { id: toStateId, organizationId: tenant.organization.id },
    include: { stage: true },
  })
  if (!toState) return { ok: false, error: 'Target state not found' }

  // Update execution
  const history = JSON.parse(execution.history || '[]') as unknown[]
  history.push({
    fromState: execution.currentStateId,
    toState: toStateId,
    changedBy: session.userId,
    changedAt: new Date().toISOString(),
    reason,
  })

  await db.blueprintExecution.update({
    where: { id: execution.id },
    data: {
      currentStateId: toStateId,
      enteredStateAt: new Date(),
      history: JSON.stringify(history),
      isComplete: toState.stateType === 'terminal',
    },
  })

  // Update deal stage + probability + forecast (tenant-scoped write)
  await db.deal.updateMany({
    where: { id: dealId, organizationId: tenant.organization.id },
    data: {
      stageId: toState.stageId,
      probability: toState.stage.probability,
      forecastCategory: toState.stage.forecastCategory,
    },
  })

  // Log DealStageHistory
  await db.dealStageHistory.create({
    data: {
      organizationId: tenant.organization.id,
      dealId,
      fromStageId: execution.currentStateId,
      toStageId: toState.stageId,
      changedById: session.userId,
      reason,
      durationInPreviousStage: Math.floor((Date.now() - execution.enteredStateAt.getTime()) / 1000),
    },
  })

  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'blueprint.transition', targetType: 'deal', targetId: dealId,
    metadata: { toState: toState.stage.name, reason, requiresApproval: validation.requiresApproval },
  })

  return { ok: true }
}

/**
 * Get available transitions for a deal (with blocked reasons).
 */
export async function getAvailableTransitions(dealId: string) {
  const { tenant } = await ctx()
  const execution = await db.blueprintExecution.findFirst({
    where: { dealId, organizationId: tenant.organization.id },
  })
  if (!execution || !execution.currentStateId) return []

  const transitions = await db.blueprintTransition.findMany({
    where: { blueprintId: execution.blueprintId, fromStateId: execution.currentStateId },
    include: {
      toState: { include: { stage: true } },
      fieldRequirements: true,
    },
  })

  return Promise.all(transitions.map(async (t) => {
    const validation = await validateTransition(dealId, t.toStateId)
    return {
      toStateId: t.toStateId,
      stageName: t.toState.stage.name,
      color: t.toState.stage.color,
      valid: validation.valid,
      blockedReason: validation.valid ? null : validation.errors.join('; '),
      missingFields: validation.missingFields,
      requiresApproval: t.requireApproval,
    }
  }))
}

/**
 * Enforce blueprint on deal creation — auto-create execution.
 */
export async function enforceOnCreate(dealId: string, pipelineId: string) {
  const { tenant } = await ctx()
  const blueprint = await db.blueprint.findFirst({
    where: { pipelineId, organizationId: tenant.organization.id, isActive: true },
  })
  if (!blueprint) return

  const deal = await db.deal.findFirst({ where: { id: dealId } })
  if (!deal) return

  // Find the state matching the deal's current stage, or the first state
  const state = await db.blueprintState.findFirst({
    where: { blueprintId: blueprint.id, stageId: deal.stageId },
  }) ?? await db.blueprintState.findFirst({
    where: { blueprintId: blueprint.id },
    include: { stage: true },
    orderBy: { createdAt: 'asc' },
  })

  if (!state) return

  await db.blueprintExecution.create({
    data: {
      organizationId: tenant.organization.id,
      dealId,
      blueprintId: blueprint.id,
      currentStateId: state.id,
      enteredStateAt: new Date(),
    },
  }).catch(() => {
    // Execution may already exist (unique on dealId)
  })
}

// ---------------------------------------------------------------------------
// Compliance + reporting
// ---------------------------------------------------------------------------

export async function getComplianceReport(pipelineId?: string) {
  const { tenant } = await ctx()
  const where = { organizationId: tenant.organization.id, deletedAt: null, ...(pipelineId ? { pipelineId } : {}) }
  const totalDeals = await db.deal.count({ where })
  const executions = await db.blueprintExecution.count({
    where: { organizationId: tenant.organization.id, deal: { deletedAt: null } },
  })
  const completed = await db.blueprintExecution.count({
    where: { organizationId: tenant.organization.id, isComplete: true },
  })

  // Stuck deals: current state has timeLimitHours and exceeded
  const stuckExecutions = await db.blueprintExecution.findMany({
    where: { organizationId: tenant.organization.id, isComplete: false },
    include: { currentState: true },
    orderBy: { enteredStateAt: 'asc' },
    take: 500,
  })
  const stuckDeals = stuckExecutions.filter((e) => {
    if (!e.currentState?.timeLimitHours) return false
    const hoursInState = (Date.now() - e.enteredStateAt.getTime()) / 3600000
    return hoursInState > e.currentState.timeLimitHours
  })

  return {
    totalDeals,
    inBlueprint: executions,
    complianceRate: totalDeals > 0 ? (executions / totalDeals) * 100 : 0,
    completed,
    stuckCount: stuckDeals.length,
  }
}

export async function getExecutions(opts: { stuckOnly?: boolean } = {}) {
  const { tenant } = await ctx()
  const executions = await db.blueprintExecution.findMany({
    where: { organizationId: tenant.organization.id, isComplete: false },
    include: {
      deal: { select: { id: true, name: true, amount: true, ownerId: true } },
      currentState: { include: { stage: true } },
      blueprint: { select: { name: true } },
    },
    orderBy: { enteredStateAt: 'desc' },
    take: 200,
  })

  const withTime = executions.map((e) => {
    const hoursInState = (Date.now() - e.enteredStateAt.getTime()) / 3600000
    const isStuck = e.currentState?.timeLimitHours ? hoursInState > e.currentState.timeLimitHours : false
    return { ...e, hoursInState: Math.round(hoursInState), isStuck }
  })

  return opts.stuckOnly ? withTime.filter((e) => e.isStuck) : withTime
}
