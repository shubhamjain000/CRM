import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { hasPermission } from '@/lib/auth/permissions'
import { createNotification } from '@/lib/realtime/handler'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

// ---------------------------------------------------------------------------
// Approval Processes
// ---------------------------------------------------------------------------

export async function listProcesses(targetModel?: string) {
  const { tenant } = await ctx()
  return db.approvalProcess.findMany({
    where: { organizationId: tenant.organization.id, isActive: true, ...(targetModel ? { targetModel } : {}) },
    include: { _count: { select: { steps: true, requests: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createProcess(data: {
  name: string; targetModel: string; triggerCriteria?: Record<string, unknown>; description?: string
}) {
  const { session, tenant } = await ctx()
  const process = await db.approvalProcess.create({
    data: {
      organizationId: tenant.organization.id,
      name: data.name,
      targetModel: data.targetModel,
      triggerCriteria: JSON.stringify(data.triggerCriteria ?? {}),
      description: data.description,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'approval_process.create', targetType: 'approval_process', targetId: process.id,
  })
  return process
}

export async function addStep(processId: string, data: {
  stepType: string; approvers: { type: string; value: string }[]; timeLimitHours?: number; requireComment?: boolean
}) {
  const { session, tenant } = await ctx()
  // Verify the process belongs to this tenant (prevents cross-org step injection)
  const process = await db.approvalProcess.findFirst({
    where: { id: processId, organizationId: tenant.organization.id },
    select: { id: true },
  })
  if (!process) throw new Error('Approval process not found')
  const lastOrder = await db.approvalStep.findFirst({
    where: { processId }, orderBy: { order: 'desc' }, select: { order: true },
  })
  return db.approvalStep.create({
    data: {
      organizationId: tenant.organization.id,
      processId,
      order: (lastOrder?.order ?? -1) + 1,
      stepType: data.stepType,
      approvers: JSON.stringify(data.approvers),
      timeLimitHours: data.timeLimitHours,
      requireComment: data.requireComment ?? false,
    },
  })
}

// ---------------------------------------------------------------------------
// Approval Requests
// ---------------------------------------------------------------------------

export async function submitRequest(data: {
  processId: string; targetModule: string; targetId: string; targetName: string
}) {
  const { session, tenant } = await ctx()
  const process = await db.approvalProcess.findFirst({
    where: { id: data.processId, organizationId: tenant.organization.id, isActive: true },
    include: { steps: { orderBy: { order: 'asc' }, take: 1 } },
  })
  if (!process) throw new Error('Approval process not found')
  if (process.steps.length === 0) throw new Error('No steps defined in this process')

  const request = await db.approvalRequest.create({
    data: {
      organizationId: tenant.organization.id,
      processId: data.processId,
      targetModule: data.targetModule,
      targetId: data.targetId,
      targetName: data.targetName,
      submittedById: session.userId,
      currentStepId: process.steps[0].id,
    },
  })

  // Notify first step approvers
  const approvers = JSON.parse(process.steps[0].approvers || '[]') as { type: string; value: string }[]
  for (const a of approvers) {
    if (a.type === 'user') {
      await createNotification({
        actorId: session.userId, verb: 'approval_requested',
        targetModule: data.targetModule, targetId: data.targetId,
        targetName: data.targetName, recipientId: a.value,
        data: { requestId: request.id, process: process.name },
      })
    }
  }

  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'approval.submit', targetType: 'approval_request', targetId: request.id,
  })
  return request
}

export async function approveRequest(requestId: string, comment?: string) {
  const { session, tenant } = await ctx()
  const request = await db.approvalRequest.findFirst({
    where: { id: requestId, organizationId: tenant.organization.id },
    include: { process: { include: { steps: { orderBy: { order: 'asc' } } } }, currentStep: true },
  })
  if (!request) throw new Error('Request not found')
  if (request.status !== 'pending') throw new Error(`Request is ${request.status}`)

  // Authorization: only designated approvers for the current step (or org admins)
  // may approve. Without this check any org member could approve any pending
  // request — a privilege-escalation bug.
  await assertCanApproveCurrentStep(session.userId, tenant.role.id, request)

  // Record action
  await db.approvalAction.create({
    data: {
      organizationId: tenant.organization.id,
      requestId, approverId: session.userId,
      action: 'approve', comment,
    },
  })

  // Find next step
  const currentOrder = request.currentStep?.order ?? 0
  const nextStep = request.process.steps.find((s) => s.order > currentOrder)

  if (nextStep) {
    await db.approvalRequest.update({
      where: { id: requestId },
      data: { currentStepId: nextStep.id },
    })
  } else {
    // Complete
    await db.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'approved', completedAt: new Date(), currentStepId: null },
    })
    // Notify submitter
    await createNotification({
      actorId: session.userId, verb: 'approved',
      targetModule: request.targetModule, targetId: request.targetId,
      targetName: request.targetName, recipientId: request.submittedById,
      data: { requestId },
    })
  }

  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'approval.approve', targetType: 'approval_request', targetId: requestId,
  })
}

export async function rejectRequest(requestId: string, comment?: string) {
  const { session, tenant } = await ctx()
  const request = await db.approvalRequest.findFirst({
    where: { id: requestId, organizationId: tenant.organization.id },
    include: { currentStep: true },
  })
  if (!request) throw new Error('Request not found')
  if (request.status !== 'pending') throw new Error(`Request is ${request.status}`)

  // Authorization: same check as approve — only current-step approvers (or admins)
  await assertCanApproveCurrentStep(session.userId, tenant.role.id, request)

  await db.approvalAction.create({
    data: {
      organizationId: tenant.organization.id,
      requestId, approverId: session.userId,
      action: 'reject', comment,
    },
  })
  await db.approvalRequest.update({
    where: { id: requestId },
    data: { status: 'rejected', completedAt: new Date(), currentStepId: null },
  })

  // Notify submitter
  await createNotification({
    actorId: session.userId, verb: 'rejected',
    targetModule: request.targetModule, targetId: request.targetId,
    targetName: request.targetName, recipientId: request.submittedById,
    data: { requestId, comment },
  })

  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'approval.reject', targetType: 'approval_request', targetId: requestId,
  })
}

export async function recallRequest(requestId: string) {
  const { session, tenant } = await ctx()
  await db.approvalRequest.updateMany({
    where: { id: requestId, organizationId: tenant.organization.id, submittedById: session.userId, status: 'pending' },
    data: { status: 'recalled', completedAt: new Date(), currentStepId: null },
  })
}

export async function getPendingApprovals() {
  const { session, tenant } = await ctx()
  // Admins see all pending requests in the org. Non-admins see only requests
  // where they are a designated approver on the current step.
  const isAdmin = await hasPermission(tenant.role.id, 'org.admin')
  if (isAdmin) {
    return db.approvalRequest.findMany({
      where: { organizationId: tenant.organization.id, status: 'pending' },
      include: {
        process: { select: { name: true } },
        actions: { orderBy: { timestamp: 'desc' }, take: 5, select: { action: true, comment: true, approverId: true, timestamp: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    })
  }
  // Non-admin: fetch pending requests in the org, then filter in JS by
  // approver membership on the current step. (Prisma can't filter on a JSON
  // column without raw SQL — keep this portable.)
  const pending = await db.approvalRequest.findMany({
    where: { organizationId: tenant.organization.id, status: 'pending' },
    include: {
      currentStep: true,
      process: { select: { name: true } },
      actions: { orderBy: { timestamp: 'desc' }, take: 5, select: { action: true, comment: true, approverId: true, timestamp: true } },
    },
    orderBy: { submittedAt: 'desc' },
    take: 200,
  })
  return pending.filter((r) => r.currentStep && isApprover(session.userId, tenant.role.id, r.currentStep.approvers))
}

/**
 * Throws if the user is not a designated approver for the current step (and not an admin).
 * approvers JSON shape (from ApprovalStep schema): `[ {type:'user'|'role', value:'<id>'} ]`
 */
async function assertCanApproveCurrentStep(
  userId: string,
  roleId: string,
  request: { currentStep: { approvers: string } | null },
): Promise<void> {
  if (!request.currentStep) {
    throw new Error('Request has no current step')
  }
  const isAdmin = await hasPermission(roleId, 'org.admin')
  if (isAdmin) return
  if (!isApprover(userId, roleId, request.currentStep.approvers)) {
    throw new Error('You are not an approver for the current step')
  }
}

/** True if the user/role is listed in the approvers JSON for the step. */
function isApprover(userId: string, roleId: string, approversJson: string): boolean {
  let list: Array<{ type: string; value: string }> = []
  try {
    list = JSON.parse(approversJson || '[]')
  } catch {
    return false
  }
  if (!Array.isArray(list)) return false
  return list.some((a) => {
    if (!a || typeof a !== 'object') return false
    if (a.type === 'user' && a.value === userId) return true
    if (a.type === 'role' && a.value === roleId) return true
    return false
  })
}

export async function getMyRequests() {
  const { session, tenant } = await ctx()
  return db.approvalRequest.findMany({
    where: { organizationId: tenant.organization.id, submittedById: session.userId },
    include: { process: { select: { name: true } } },
    orderBy: { submittedAt: 'desc' },
    take: 100,
  })
}

// ---------------------------------------------------------------------------
// Validation Rules
// ---------------------------------------------------------------------------

export async function listValidationRules(targetModel?: string) {
  const { tenant } = await ctx()
  return db.validationRule.findMany({
    where: { organizationId: tenant.organization.id, isActive: true, ...(targetModel ? { targetModel } : {}) },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createValidationRule(data: {
  targetModel: string; fieldName: string; conditionType: string
  conditionValue?: Record<string, unknown>; errorMessage: string; errorSeverity?: string; triggerOn?: string
}) {
  const { session, tenant } = await ctx()
  return db.validationRule.create({
    data: {
      organizationId: tenant.organization.id,
      targetModel: data.targetModel,
      fieldName: data.fieldName,
      conditionType: data.conditionType,
      conditionValue: JSON.stringify(data.conditionValue ?? {}),
      errorMessage: data.errorMessage,
      errorSeverity: data.errorSeverity ?? 'error',
      triggerOn: data.triggerOn ?? 'both',
    },
  })
}

export async function deleteValidationRule(id: string) {
  const { tenant } = await ctx()
  await db.validationRule.deleteMany({ where: { id, organizationId: tenant.organization.id } })
}

export function evaluateRule(rule: { conditionType: string; conditionValue: string; fieldName: string; errorMessage: string; errorSeverity: string }, data: Record<string, unknown>): { valid: boolean; message?: string; severity: string } {
  const value = data[rule.fieldName]
  const conditions = JSON.parse(rule.conditionValue || '{}') as Record<string, unknown>

  switch (rule.conditionType) {
    case 'required':
      if (!value || value === '') return { valid: false, message: rule.errorMessage, severity: rule.errorSeverity }
      break
    case 'regex':
      if (value && typeof conditions.regex === 'string') {
        const re = new RegExp(conditions.regex)
        if (!re.test(String(value))) return { valid: false, message: rule.errorMessage, severity: rule.errorSeverity }
      }
      break
    case 'range':
      if (typeof value === 'number') {
        if (conditions.min !== undefined && value < Number(conditions.min)) return { valid: false, message: rule.errorMessage, severity: rule.errorSeverity }
        if (conditions.max !== undefined && value > Number(conditions.max)) return { valid: false, message: rule.errorMessage, severity: rule.errorSeverity }
      }
      break
    case 'unique':
      // Simplified — would need DB check
      break
  }
  return { valid: true, severity: rule.errorSeverity }
}

// ---------------------------------------------------------------------------
// Assignment Rules
// ---------------------------------------------------------------------------

export async function listAssignmentRules(targetModel?: string) {
  const { tenant } = await ctx()
  return db.assignmentRule.findMany({
    where: { organizationId: tenant.organization.id, isActive: true, ...(targetModel ? { targetModel } : {}) },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createAssignmentRule(data: {
  targetModel: string; criteria?: Record<string, unknown>; strategy: string
  assignTo: string[]; fallbackUserId?: string; territoryField?: string
}) {
  const { session, tenant } = await ctx()
  return db.assignmentRule.create({
    data: {
      organizationId: tenant.organization.id,
      targetModel: data.targetModel,
      criteria: JSON.stringify(data.criteria ?? {}),
      strategy: data.strategy,
      assignTo: JSON.stringify(data.assignTo),
      fallbackUserId: data.fallbackUserId,
      territoryField: data.territoryField,
    },
  })
}

export async function deleteAssignmentRule(id: string) {
  const { tenant } = await ctx()
  await db.assignmentRule.deleteMany({ where: { id, organizationId: tenant.organization.id } })
}

// ---------------------------------------------------------------------------
// Escalation Rules
// ---------------------------------------------------------------------------

export async function listEscalationRules(targetModel?: string) {
  const { tenant } = await ctx()
  return db.escalationRule.findMany({
    where: { organizationId: tenant.organization.id, isActive: true, ...(targetModel ? { targetModel } : {}) },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createEscalationRule(data: {
  targetModel: string; criteria?: Record<string, unknown>; timeLimitHours: number
  escalateTo?: { type: string; value: string }; action?: string
}) {
  const { session, tenant } = await ctx()
  return db.escalationRule.create({
    data: {
      organizationId: tenant.organization.id,
      targetModel: data.targetModel,
      criteria: JSON.stringify(data.criteria ?? {}),
      timeLimitHours: data.timeLimitHours,
      escalateTo: JSON.stringify(data.escalateTo ?? {}),
      action: data.action ?? 'notify',
    },
  })
}

export async function deleteEscalationRule(id: string) {
  const { tenant } = await ctx()
  await db.escalationRule.deleteMany({ where: { id, organizationId: tenant.organization.id } })
}

export async function listEscalationLogs() {
  const { tenant } = await ctx()
  return db.escalationLog.findMany({
    where: { organizationId: tenant.organization.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}
