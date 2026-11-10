import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { createNotification } from '@/lib/realtime/handler'
import { sendEmail } from '@/lib/email/handler'
import { CSM_VALUES, csmDueDate } from '@/lib/csm'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

export const TRIGGER_TYPES = [
  'record_create', 'record_update', 'record_delete', 'field_change',
  'schedule', 'signal', 'webhook_received', 'manual',
  'approval_approved', 'approval_rejected', 'blueprint_transition',
  'record_create_or_update', 'date_based',
] as const

export const ACTION_TYPES = [
  { value: 'send_email', label: 'Send Email', icon: 'Mail' },
  { value: 'update_field', label: 'Update Field', icon: 'Edit' },
  { value: 'create_record', label: 'Create Record', icon: 'Plus' },
  { value: 'create_task', label: 'Create Task', icon: 'CheckSquare' },
  { value: 'webhook', label: 'Webhook', icon: 'Globe' },
  { value: 'alert', label: 'Alert', icon: 'Bell' },
  { value: 'assign_record', label: 'Assign Record', icon: 'User' },
  { value: 'send_sms', label: 'Send SMS', icon: 'MessageSquare' },
  { value: 'delay', label: 'Delay', icon: 'Clock' },
  { value: 'if_else', label: 'If/Else Branch', icon: 'GitBranch' },
  { value: 'add_tag', label: 'Add Tag', icon: 'Tag' },
  { value: 'remove_tag', label: 'Remove Tag', icon: 'Tag' },
  { value: 'notify_team', label: 'Notify Team', icon: 'Users' },
  { value: 'http', label: 'HTTP Call', icon: 'Globe' },
  { value: 'update_csm_next_step', label: 'Set CSM Next Step', icon: 'ListChecks' },
  { value: 'update_csm_status', label: 'Set CSM Status', icon: 'ClipboardCheck' },
  { value: 'send_email_owner', label: 'Email Record Owner', icon: 'MailPlus' },
  { value: 'notify_inapp_owner', label: 'Notify Owner In-App', icon: 'BellRing' },
  { value: 'create_task_owner', label: 'Create Task for Owner', icon: 'UserPlus' },
  { value: 'set_last_reached_out', label: 'Stamp Last Reached-Out', icon: 'Timer' },
  { value: 'increment_reachouts', label: 'Increment Reachouts', icon: 'TrendingUp' },
  { value: 'send_email_contact', label: 'Email the Contact', icon: 'Send' },
] as const

export const TEMPLATES = [
  {
    name: 'Welcome New Lead',
    description: 'Send welcome email + create follow-up task when a new lead is created',
    triggerType: 'record_create',
    triggerModel: 'lead',
    actions: [
      { actionType: 'send_email', config: { recipient: 'record.email', subject: 'Welcome to Unstop!', message: 'Hi {{firstName}}, welcome aboard — we are excited to work with you.' } },
      { actionType: 'create_task', config: { title: 'Follow up with new lead', dueInDays: 1 } },
    ],
  },
  {
    name: 'Follow-up Reminder Sequence',
    description: 'Create tasks for follow-ups when lead status changes to contacted',
    triggerType: 'record_update',
    triggerModel: 'lead',
    actions: [
      { actionType: 'create_task', config: { title: 'Call lead', dueInDays: 2 } },
      { actionType: 'alert', config: { message: 'Lead contacted — follow up scheduled' } },
    ],
  },
  {
    name: 'Win Deal Celebration',
    description: 'Notify team + create onboarding task when deal is won',
    triggerType: 'field_change',
    triggerModel: 'deal',
    actions: [
      { actionType: 'notify_team', config: { message: 'Deal won! 🎉' } },
      { actionType: 'create_task', config: { title: 'Start onboarding', dueInDays: 3 } },
    ],
  },
  {
    name: 'Re-engage Dormant Lead',
    description: 'Alert owner when lead has no activity for 30 days',
    triggerType: 'schedule',
    triggerModel: 'lead',
    actions: [
      { actionType: 'alert', config: { message: 'Lead dormant 30+ days — re-engage!' } },
    ],
  },
  {
    name: 'Approval Reminder Escalation',
    description: 'Notify manager when approval pending > 48h',
    triggerType: 'schedule',
    triggerModel: 'approval',
    actions: [
      { actionType: 'notify_team', config: { message: 'Approval pending 48h — escalating' } },
    ],
  },
] as const

// ---------------------------------------------------------------------------
// Workflow CRUD
// ---------------------------------------------------------------------------

export async function listWorkflows() {
  const { tenant } = await ctx()
  return db.workflowRule.findMany({
    where: { organizationId: tenant.organization.id },
    include: { _count: { select: { actions: true, executions: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getWorkflow(id: string) {
  const { tenant } = await ctx()
  return db.workflowRule.findFirst({
    where: { id, organizationId: tenant.organization.id },
    include: {
      actions: { orderBy: { order: 'asc' } },
      executions: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  })
}

export async function createWorkflow(data: {
  name: string; triggerType: string; triggerModel?: string; triggerConditions?: Record<string, unknown>
}) {
  const { session, tenant } = await ctx()
  const rule = await db.workflowRule.create({
    data: {
      organizationId: tenant.organization.id,
      name: data.name,
      triggerType: data.triggerType,
      triggerModel: data.triggerModel,
      triggerConditions: JSON.stringify(data.triggerConditions ?? {}),
      createdById: session.userId,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'workflow.create', targetType: 'workflow_rule', targetId: rule.id,
  })
  return rule
}

export async function updateWorkflow(id: string, data: Record<string, unknown>) {
  const { session, tenant } = await ctx()
  await db.workflowRule.updateMany({ where: { id, organizationId: tenant.organization.id }, data })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'workflow.update', targetType: 'workflow_rule', targetId: id,
  })
}

export async function deleteWorkflow(id: string) {
  const { session, tenant } = await ctx()
  await db.workflowRule.deleteMany({ where: { id, organizationId: tenant.organization.id } })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'workflow.delete', targetType: 'workflow_rule', targetId: id,
  })
}

export async function activateWorkflow(id: string, active: boolean) {
  const { session, tenant } = await ctx()
  await db.workflowRule.updateMany({ where: { id, organizationId: tenant.organization.id }, data: { isActive: active } })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: active ? 'workflow.activate' : 'workflow.deactivate',
    targetType: 'workflow_rule', targetId: id,
  })
}

export async function duplicateWorkflow(id: string) {
  const { session, tenant } = await ctx()
  const original = await db.workflowRule.findFirst({
    where: { id, organizationId: tenant.organization.id },
    include: { actions: true },
  })
  if (!original) throw new Error('Not found')
  const copy = await db.workflowRule.create({
    data: {
      organizationId: tenant.organization.id,
      name: `${original.name} (copy)`,
      triggerType: original.triggerType,
      triggerModel: original.triggerModel,
      triggerConditions: original.triggerConditions,
      createdById: session.userId,
    },
  })
  for (const action of original.actions) {
    await db.workflowAction.create({
      data: {
        organizationId: tenant.organization.id,
        ruleId: copy.id,
        order: action.order,
        actionType: action.actionType,
        config: action.config,
      },
    })
  }
  return copy
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function addAction(ruleId: string, data: {
  actionType: string; config?: Record<string, unknown>
}) {
  const { tenant } = await ctx()
  const lastOrder = await db.workflowAction.findFirst({
    where: { ruleId }, orderBy: { order: 'desc' }, select: { order: true },
  })
  return db.workflowAction.create({
    data: {
      organizationId: tenant.organization.id,
      ruleId,
      order: (lastOrder?.order ?? -1) + 1,
      actionType: data.actionType,
      config: JSON.stringify(data.config ?? {}),
    },
  })
}

export async function deleteAction(actionId: string) {
  const { tenant } = await ctx()
  await db.workflowAction.deleteMany({ where: { id: actionId, organizationId: tenant.organization.id } })
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export async function testRun(ruleId: string, targetModule: string, targetId: string) {
  const { session, tenant } = await ctx()
  const rule = await db.workflowRule.findFirst({
    where: { id: ruleId, organizationId: tenant.organization.id },
    include: { actions: { orderBy: { order: 'asc' } } },
  })
  if (!rule) throw new Error('Workflow not found')

  // runRuleActions keeps the exact execution-log shape ({action,status,error})
  // and rule counter behavior the original testRun had.
  const result = await runRuleActions(
    rule,
    { module: targetModule, id: targetId },
    { userId: session.userId, organizationId: tenant.organization.id },
  )
  return { id: result.id }
}

// ---------------------------------------------------------------------------
// Shared rule runner — used by testRun AND live trigger firing
// ---------------------------------------------------------------------------

export interface WorkflowRuleLike {
  id?: string
  name?: string
  actions: { actionType: string; config: string }[]
}

export interface RunRuleActionsTarget {
  module: string
  id: string
  /** Full record snapshot when available (live trigger firing); null for test runs. */
  record?: Record<string, unknown> | null
}

export interface RunRuleActionsCtx {
  userId: string
  organizationId: string
}

export interface RunRuleActionResult {
  id: string
  status: string
  actionsLog: { action: string; status: string; error?: string; detail?: string }[]
}

/**
 * Execute every action of a rule in order, recording one WorkflowExecution row
 * with the per-action log, and bumping the rule's runCount/lastRunAt (or
 * errorCount when the run itself blew up). NEVER throws — automations must not
 * break record saves.
 *
 * opts.live=true additionally counts an execution that ended 'failed' (any
 * action failure) against the rule's errorCount — live runs only; testRun
 * keeps its historical counter behavior.
 */
export async function runRuleActions(
  rule: WorkflowRuleLike,
  target: RunRuleActionsTarget,
  ctxp: RunRuleActionsCtx,
  opts?: { live?: boolean },
): Promise<RunRuleActionResult> {
  const actionsLog: { action: string; status: string; error?: string; detail?: string }[] = []
  const ruleId = rule.id ?? null
  try {
    const execution = await db.workflowExecution.create({
      data: {
        organizationId: ctxp.organizationId,
        ruleId,
        targetModule: target.module,
        targetId: target.id,
        status: 'running',
      },
    })

    try {
      for (const action of rule.actions ?? []) {
        let config: Record<string, unknown> = {}
        try {
          config = JSON.parse(action.config || '{}')
        } catch { config = {} }
        try {
          const result = await executeAction(
            action.actionType, config, target.module, target.id,
            ctxp.userId, ctxp.organizationId,
            { record: target.record ?? null, rule: { id: rule.id ?? null, name: rule.name ?? '' } },
          )
          actionsLog.push(
            result.status === 'completed'
              ? (result.detail
                  ? { action: action.actionType, status: 'completed', detail: result.detail }
                  : { action: action.actionType, status: 'completed' })
              : { action: action.actionType, status: result.status, error: result.error },
          )
        } catch (e) {
          actionsLog.push({ action: action.actionType, status: 'failed', error: e instanceof Error ? e.message : 'Unknown' })
        }
      }

      const status = actionsLog.some((a) => a.status === 'failed') ? 'failed' : 'completed'
      await db.workflowExecution.update({
        where: { id: execution.id },
        data: {
          status,
          completedAt: new Date(),
          actionsExecuted: JSON.stringify(actionsLog),
        },
      })
      if (ruleId) {
        const data: { lastRunAt: Date; runCount?: { increment: number }; errorCount?: { increment: number } } = {
          lastRunAt: new Date(), runCount: { increment: 1 },
        }
        if (opts?.live && status === 'failed') data.errorCount = { increment: 1 }
        await db.workflowRule.update({ where: { id: ruleId }, data })
      }
      return { id: execution.id, status, actionsLog }
    } catch (e) {
      await db.workflowExecution.update({
        where: { id: execution.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: e instanceof Error ? e.message : 'Unknown error',
          actionsExecuted: JSON.stringify(actionsLog),
        },
      }).catch(() => {})
      if (ruleId) {
        await db.workflowRule.update({ where: { id: ruleId }, data: { errorCount: { increment: 1 } } }).catch(() => {})
      }
      return { id: execution.id, status: 'failed', actionsLog }
    }
  } catch (e) {
    // Even creating the execution row failed — log and bail without throwing.
    console.error('[workflow] runRuleActions failed', ruleId, e)
    return { id: '', status: 'failed', actionsLog }
  }
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

export interface ActionResult {
  status: 'completed' | 'skipped' | 'failed'
  error?: string
  /** Non-failure detail for the execution log (e.g. http's 'posted (200)'). */
  detail?: string
}

const ACTION_OK: ActionResult = { status: 'completed' }
const skip = (error: string): ActionResult => ({ status: 'skipped', error })

/** Best-effort owner lookup for the target record (tenant-scoped). */
async function getRecordOwner(module: string, id: string, organizationId: string): Promise<{ ownerId: string; email: string; name: string } | null> {
  try {
    const delegate = db[module as 'lead' | 'deal' | 'contact' | 'account'] as any
    if (!delegate) return null
    const rec = await delegate.findFirst({ where: { id, organizationId }, select: { ownerId: true } })
    if (!rec?.ownerId) return null
    const user = await db.user.findUnique({ where: { id: rec.ownerId }, select: { email: true, name: true } })
    if (!user?.email) return null
    return { ownerId: rec.ownerId, email: user.email, name: user.name }
  } catch {
    return null
  }
}

const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Recipient sentinels that mean "the target record's own address": 'record.email' (and the legacy '<model>.email' form). */
function isRecordEmailSentinel(value: string): boolean {
  return /^[a-z]+\.email$/i.test(value)
}

/** First email address from a Contact `emails` JSON column ('["a@b.com", ...]'). */
function firstEmailFromJson(raw: string | null | undefined): string | null {
  try {
    const list = JSON.parse(raw || '[]')
    if (!Array.isArray(list)) return null
    for (const entry of list) {
      if (typeof entry === 'string' && entry.trim()) return entry.trim()
      if (entry && typeof entry === 'object') {
        const v = (entry as Record<string, unknown>).value ?? (entry as Record<string, unknown>).email
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Primary email of the target record: first entry of its `emails` JSON column
 * ('["a@b.com"]') — Lead and Contact both store addresses that way. Tenant-
 * scoped like every other record lookup here; returns null when the module has
 * no such column (deal/account) or the record has no address.
 */
async function getRecordPrimaryEmail(module: string, id: string, organizationId: string): Promise<string | null> {
  try {
    const delegate = db[module as 'lead' | 'deal' | 'contact' | 'account'] as any
    if (!delegate) return null
    const rec = await delegate.findFirst({ where: { id, organizationId }, select: { emails: true } })
    return firstEmailFromJson(rec?.emails)
  } catch {
    return null
  }
}

/**
 * Best-effort: an active connected Gmail mailbox owned by any of the given
 * users (org-scoped, checked in order). Returns undefined when none — workflow
 * execution must never fail because of this lookup, and without a mailbox the
 * send falls back to the existing SMTP/queue path.
 */
async function findGmailAccountId(organizationId: string, userIds: (string | undefined | null)[]): Promise<string | undefined> {
  try {
    for (const uid of userIds) {
      if (!uid) continue
      const acct = await db.emailAccount.findFirst({
        where: { organizationId, userId: uid, provider: 'gmail', isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (acct) return acct.id
    }
  } catch { /* fall through to the plain SMTP/queue path */ }
  return undefined
}

function htmlBody(message: unknown, fallback: string): string {
  const text = String(message ?? '').trim() || fallback
  return text
    .split('\n')
    .map((line) => `<p style="margin:0 0 8px 0">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('')
}

async function executeAction(
  actionType: string,
  config: Record<string, unknown>,
  targetModule: string,
  targetId: string,
  userId: string,
  organizationId: string,
  extra?: { record?: Record<string, unknown> | null; rule?: { id: string | null; name: string } },
): Promise<ActionResult> {
  switch (actionType) {
    case 'send_email': {
      // REAL send: delegate to the email service with config-provided fields.
      // Recipients come from config.to (comma separated); the 'record.email'
      // sentinel in config.recipient (or a legacy '<model>.email' token) and an
      // empty To all fall back to the target record's primary email address.
      const rawTo = config.to ?? config.recipient
      const tokens = (Array.isArray(rawTo) ? rawTo : String(rawTo ?? '').split(','))
        .map((x) => String(x).trim())
        .filter(Boolean)
      const useRecordEmail =
        config.recipient === 'record.email' ||
        tokens.length === 0 ||
        tokens.some(isRecordEmailSentinel)
      let to = tokens.filter((t) => !isRecordEmailSentinel(t))
      if (useRecordEmail) {
        const recordEmail = await getRecordPrimaryEmail(targetModule, targetId, organizationId)
        if (recordEmail && !to.some((x) => x.toLowerCase() === recordEmail.toLowerCase())) {
          to = [...to, recordEmail]
        }
      }
      const subject = String(config.subject ?? '').trim()
      if (to.length === 0) {
        return { status: 'failed', error: 'No recipient — set To or enable use-record-email' }
      }
      if (!subject) {
        return { status: 'failed', error: 'send_email requires config.subject' }
      }
      const badRecipient = to.find((x) => !EMAIL_ADDRESS_RE.test(x))
      if (badRecipient) {
        return { status: 'failed', error: `send_email config.to contains an invalid recipient: "${badRecipient}"` }
      }
      try {
        await sendEmail({
          to,
          subject,
          bodyHtml: htmlBody(config.message ?? config.body, 'Workflow notification'),
          relatedModule: targetModule,
          relatedId: targetId,
          // Optional explicit mailbox (e.g. a connected Gmail account id).
          ...(typeof config.accountId === 'string' && config.accountId.trim() ? { accountId: config.accountId.trim() } : {}),
        })
      } catch (e) {
        return { status: 'failed', error: e instanceof Error ? e.message : 'email send failed' }
      }
      break
    }
    case 'update_field': {
      const delegate = db[targetModule as 'lead' | 'deal' | 'contact' | 'account'] as any
      if (delegate && config.field) {
        // Tenant-scoped: prevents mutating another organization's record by id
        await delegate.updateMany({ where: { id: targetId, organizationId }, data: { [config.field as string]: config.value } })
      }
      break
    }
    case 'create_task':
      await db.task.create({
        data: {
          organizationId,
          title: String(config.title ?? 'Workflow task'),
          dueDate: config.dueInDays ? new Date(Date.now() + Number(config.dueInDays) * 86400000) : null,
          ownerId: userId,
          createdById: userId,
          status: 'not_started',
          priority: 'medium',
          relatedModule: targetModule,
          relatedId: targetId,
        },
      })
      break
    case 'alert':
      await createNotification({
        actorId: userId, verb: 'workflow_alert',
        targetModule, targetId, targetName: String(config.message ?? 'Workflow alert'),
        recipientId: userId,
      })
      break
    case 'add_tag':
    case 'remove_tag': {
      const delegate = db[targetModule as 'lead' | 'deal' | 'contact' | 'account'] as any
      if (delegate && config.tag) {
        // Tenant-scoped read + write
        const record = await delegate.findFirst({ where: { id: targetId, organizationId }, select: { tags: true } })
        const tags = JSON.parse(record?.tags || '[]') as string[]
        const tag = String(config.tag)
        const newTags = actionType === 'add_tag' ? [...new Set([...tags, tag])] : tags.filter((t) => t !== tag)
        await delegate.updateMany({ where: { id: targetId, organizationId }, data: { tags: JSON.stringify(newTags) } })
      }
      break
    }
    case 'notify_team':
      await createNotification({
        actorId: userId, verb: 'workflow_notify',
        targetModule, targetId, targetName: String(config.message ?? 'Team notification'),
        recipientId: userId,
      })
      break
    case 'assign_record': {
      const delegate = db[targetModule as 'lead' | 'deal' | 'contact' | 'account'] as any
      if (delegate && config.assignTo) {
        // Tenant-scoped: prevents reassigning another organization's record
        await delegate.updateMany({ where: { id: targetId, organizationId }, data: { ownerId: config.assignTo } })
      }
      break
    }
    case 'delay':
      // Would use Celery countdown in production
      break
    case 'if_else':
      // Would evaluate condition + branch
      break
    case 'send_sms':
      // No SMS channel is wired up yet — record a skip instead of silently "succeeding".
      return skip('No SMS provider connected — connect a channel first')
    case 'create_record':
      return skip('create_record is not supported yet')
    case 'http': {
      // Real POST of config.body (default {}) to config.url — https only, 10s timeout.
      const url = String(config.url ?? '').trim()
      if (!/^https:\/\//i.test(url)) throw new Error('http requires an https config.url')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config.body ?? {}),
          signal: controller.signal,
        })
      } catch (e) {
        throw new Error(`http failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) throw new Error(`http responded with HTTP ${res.status}`)
      return { status: 'completed', detail: `posted (${res.status})` }
    }
    case 'webhook': {
      // Real fire-and-forget webhook: 5s timeout, http/https only.
      const url = String(config.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) return skip('skipped: webhook url must be a valid http(s) URL')
      const method = String(config.method ?? 'POST').toUpperCase()
      const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
      const verb = allowedMethods.includes(method) ? method : 'POST'
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      try {
        const res = await fetch(url, {
          method: verb,
          headers: { 'Content-Type': 'application/json' },
          body: verb === 'GET' ? undefined : JSON.stringify({ record: extra?.record ?? null, rule: extra?.rule ?? null }),
          signal: controller.signal,
        })
        if (!res.ok) return { status: 'failed', error: `webhook responded with HTTP ${res.status}` }
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'Unknown error'
        return { status: 'failed', error: `webhook failed: ${reason}` }
      } finally {
        clearTimeout(timer)
      }
      break
    }
    // ----- CSM automation actions (additive) -----
    case 'update_csm_next_step': {
      if (targetModule !== 'contact') return skip('skipped: target record is not a contact')
      const value = String(config.value ?? '')
      if (!CSM_VALUES.includes(value)) return { status: 'failed', error: `invalid CSM next step: "${value}"` }
      await db.contact.updateMany({
        where: { id: targetId, organizationId },
        data: { csmNextStep: value, csmNextStepAt: new Date(), csmNextStepDueAt: csmDueDate(value) },
      })
      break
    }
    case 'update_csm_status': {
      if (targetModule !== 'contact') return skip('skipped: target record is not a contact')
      const value = String(config.value ?? '').trim()
      if (!value) return { status: 'failed', error: 'CSM status value is empty' }
      await db.contact.updateMany({ where: { id: targetId, organizationId }, data: { csmStatus: value } })
      break
    }
    case 'send_email_owner': {
      const owner = await getRecordOwner(targetModule, targetId, organizationId)
      if (!owner) return skip('skipped: no owner email')
      // Prefer sending through a connected Gmail mailbox (owner first, then the
      // acting user); without one, sendEmail uses SMTP/queue exactly as before.
      const gmailAccountId = await findGmailAccountId(organizationId, [owner.ownerId, userId])
      try {
        await sendEmail({
          to: [owner.email],
          subject: String(config.subject ?? 'Workflow update'),
          bodyHtml: htmlBody(config.message, 'A workflow was executed on one of your records.'),
          relatedModule: targetModule,
          relatedId: targetId,
          ...(gmailAccountId ? { accountId: gmailAccountId } : {}),
        })
      } catch (e) {
        return { status: 'failed', error: e instanceof Error ? e.message : 'email send failed' }
      }
      break
    }
    case 'notify_inapp_owner': {
      const owner = await getRecordOwner(targetModule, targetId, organizationId)
      if (!owner) return skip('skipped: no owner')
      await createNotification({
        actorId: userId, verb: 'workflow_owner_notify',
        targetModule, targetId, targetName: String(config.message ?? 'Workflow notification'),
        recipientId: owner.ownerId,
      })
      break
    }
    case 'create_task_owner': {
      const owner = await getRecordOwner(targetModule, targetId, organizationId)
      const ownerId = owner?.ownerId ?? userId // fallback: acting user
      await db.task.create({
        data: {
          organizationId,
          title: String(config.title ?? 'Workflow task'),
          dueDate: config.dueInDays ? new Date(Date.now() + Number(config.dueInDays) * 86400000) : null,
          ownerId,
          createdById: userId,
          status: 'not_started',
          priority: 'medium',
          relatedModule: targetModule,
          relatedId: targetId,
        },
      })
      break
    }
    case 'set_last_reached_out': {
      if (targetModule !== 'contact') return skip('skipped: target record is not a contact')
      await db.contact.updateMany({ where: { id: targetId, organizationId }, data: { lastReachedOutAt: new Date() } })
      break
    }
    case 'increment_reachouts': {
      if (targetModule !== 'contact') return skip('skipped: target record is not a contact')
      // Read-then-update (tenant-scoped); SQLite has no atomic JSON-free increment via updateMany.
      const rec = await db.contact.findFirst({ where: { id: targetId, organizationId }, select: { totalReachoutsDone: true } })
      await db.contact.updateMany({
        where: { id: targetId, organizationId },
        data: { totalReachoutsDone: (rec?.totalReachoutsDone ?? 0) + 1 },
      })
      break
    }
    case 'send_email_contact': {
      if (targetModule !== 'contact') return skip('skipped: target record is not a contact')
      const rec = await db.contact.findFirst({ where: { id: targetId, organizationId }, select: { emails: true } })
      const to = firstEmailFromJson(rec?.emails)
      if (!to) return skip('skipped: contact has no email address')
      // Prefer sending through the acting user's connected Gmail mailbox (then
      // the record owner's); without one, sendEmail uses SMTP/queue as before.
      const owner = await getRecordOwner(targetModule, targetId, organizationId)
      const gmailAccountId = await findGmailAccountId(organizationId, [userId, owner?.ownerId])
      try {
        await sendEmail({
          to: [to],
          subject: String(config.subject ?? 'Workflow update'),
          bodyHtml: htmlBody(config.message, 'A workflow was executed on this record.'),
          relatedModule: targetModule,
          relatedId: targetId,
          ...(gmailAccountId ? { accountId: gmailAccountId } : {}),
        })
      } catch (e) {
        return { status: 'failed', error: e instanceof Error ? e.message : 'email send failed' }
      }
      break
    }
  }
  return ACTION_OK
}

// ---------------------------------------------------------------------------
// Execution history + metrics
// ---------------------------------------------------------------------------

export async function getExecutionHistory(ruleId: string) {
  const { tenant } = await ctx()
  return db.workflowExecution.findMany({
    where: { ruleId, organizationId: tenant.organization.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
}

export async function getMetrics(ruleId: string) {
  const { tenant } = await ctx()
  const [total, failed, lastRun] = await Promise.all([
    db.workflowExecution.count({ where: { ruleId, organizationId: tenant.organization.id } }),
    db.workflowExecution.count({ where: { ruleId, organizationId: tenant.organization.id, status: 'failed' } }),
    db.workflowExecution.findFirst({ where: { ruleId }, orderBy: { createdAt: 'desc' }, select: { startedAt: true, completedAt: true } }),
  ])
  return {
    totalRuns: total,
    successRate: total > 0 ? ((total - failed) / total) * 100 : 0,
    errorCount: failed,
    lastRunAt: lastRun?.startedAt ?? null,
    avgExecutionTime: lastRun?.completedAt && lastRun?.startedAt
      ? lastRun.completedAt.getTime() - lastRun.startedAt.getTime()
      : 0,
  }
}

// ---------------------------------------------------------------------------
// Scheduled Jobs
// ---------------------------------------------------------------------------

export async function listScheduledJobs() {
  const { tenant } = await ctx()
  return db.scheduledJob.findMany({
    where: { organizationId: tenant.organization.id },
    include: { _count: { select: { logs: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createScheduledJob(data: {
  name: string; cronExpression: string; actionType: string; config?: Record<string, unknown>
}) {
  const { session, tenant } = await ctx()
  return db.scheduledJob.create({
    data: {
      organizationId: tenant.organization.id,
      name: data.name,
      cronExpression: data.cronExpression,
      actionType: data.actionType,
      config: JSON.stringify(data.config ?? {}),
      nextRunAt: new Date(Date.now() + 60000), // 1min from now as initial
    },
  })
}

export async function toggleScheduledJob(id: string, status: 'active' | 'paused') {
  const { tenant } = await ctx()
  await db.scheduledJob.updateMany({ where: { id, organizationId: tenant.organization.id }, data: { status } })
}
