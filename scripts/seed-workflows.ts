/**
 * Seed demo workflows (automation rules) + actions + executions for the demo
 * organization so the Workflows builder and the Execution Dashboard have real
 * data to render.
 *
 * Idempotent: workflows are upserted by (organizationId, name); executions are
 * only seeded when the workflow has none yet, so re-runs converge.
 *
 * Run: bun run scripts/seed-workflows.ts
 */
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

interface WfSpec {
  name: string
  triggerType: string
  triggerModel: string | null
  triggerConditions: Record<string, unknown>
  isActive: boolean
  actions: { actionType: string; config: Record<string, unknown> }[]
  /** Executions to seed when the workflow has none yet. */
  executions: {
    targetModule: string
    targetId: string
    status: 'completed' | 'failed' | 'running'
    daysAgo: number
    errorMessage?: string
    actionsExecuted: { action: string; status: string; error?: string }[]
  }[]
}

const SPECS: WfSpec[] = [
  {
    name: 'Welcome New Lead',
    triggerType: 'record_create',
    triggerModel: 'lead',
    triggerConditions: {},
    isActive: true,
    actions: [
      { actionType: 'send_email', config: { title: 'Welcome to Unstop', message: 'Intro email with a meeting link' } },
      { actionType: 'create_task', config: { title: 'Qualify new lead — discovery call', dueInDays: 2 } },
      { actionType: 'add_tag', config: { tag: 'new-lead' } },
    ],
    executions: [
      { targetModule: 'lead', targetId: 'seed-lead-1', status: 'completed', daysAgo: 1, actionsExecuted: [{ action: 'send_email', status: 'success' }, { action: 'create_task', status: 'success' }, { action: 'add_tag', status: 'success' }] },
      { targetModule: 'lead', targetId: 'seed-lead-2', status: 'completed', daysAgo: 2, actionsExecuted: [{ action: 'send_email', status: 'success' }, { action: 'create_task', status: 'success' }, { action: 'add_tag', status: 'success' }] },
      { targetModule: 'lead', targetId: 'seed-lead-3', status: 'completed', daysAgo: 3, actionsExecuted: [{ action: 'send_email', status: 'success' }, { action: 'create_task', status: 'success' }, { action: 'add_tag', status: 'success' }] },
      { targetModule: 'lead', targetId: 'seed-lead-4', status: 'failed', daysAgo: 4, errorMessage: 'Email send failed: invalid recipient address', actionsExecuted: [{ action: 'send_email', status: 'error', error: 'invalid recipient address' }] },
      { targetModule: 'lead', targetId: 'seed-lead-5', status: 'completed', daysAgo: 6, actionsExecuted: [{ action: 'send_email', status: 'success' }, { action: 'create_task', status: 'success' }, { action: 'add_tag', status: 'success' }] },
    ],
  },
  {
    name: 'Deal Won — Kick Off Onboarding',
    triggerType: 'field_change',
    triggerModel: 'deal',
    triggerConditions: { field: 'stage', value: 'Closed Won' },
    isActive: true,
    actions: [
      { actionType: 'create_task', config: { title: 'Onboarding kickoff call with customer', dueInDays: 3 } },
      { actionType: 'notify_team', config: { message: 'New closed-won deal — start onboarding' } },
      { actionType: 'update_field', config: { field: 'description', value: 'Handed over to onboarding' } },
    ],
    executions: [
      { targetModule: 'deal', targetId: 'seed-deal-1', status: 'completed', daysAgo: 1, actionsExecuted: [{ action: 'create_task', status: 'success' }, { action: 'notify_team', status: 'success' }, { action: 'update_field', status: 'success' }] },
      { targetModule: 'deal', targetId: 'seed-deal-2', status: 'completed', daysAgo: 5, actionsExecuted: [{ action: 'create_task', status: 'success' }, { action: 'notify_team', status: 'success' }, { action: 'update_field', status: 'success' }] },
      { targetModule: 'deal', targetId: 'seed-deal-3', status: 'completed', daysAgo: 9, actionsExecuted: [{ action: 'create_task', status: 'success' }, { action: 'notify_team', status: 'success' }, { action: 'update_field', status: 'success' }] },
    ],
  },
  {
    name: 'Hot Lead Alert',
    triggerType: 'field_change',
    triggerModel: 'lead',
    triggerConditions: { field: 'leadSource', value: 'Referral' },
    isActive: false,
    actions: [
      { actionType: 'alert', config: { message: 'Referral lead arrived — respond within 1 hour' } },
      { actionType: 'assign_record', config: { message: 'Assign to the top performer of the week' } },
    ],
    executions: [
      { targetModule: 'lead', targetId: 'seed-lead-7', status: 'completed', daysAgo: 2, actionsExecuted: [{ action: 'alert', status: 'success' }, { action: 'assign_record', status: 'success' }] },
      { targetModule: 'lead', targetId: 'seed-lead-8', status: 'running', daysAgo: 0, actionsExecuted: [{ action: 'alert', status: 'success' }] },
    ],
  },
]

async function main() {
  // Demo org — same resolution order as seed-owners.ts.
  let org = await db.organization.findFirst({ where: { slug: 'zia-data-qa-s-workspace' } })
  if (!org) {
    const zia = await db.user.findFirst({ where: { email: 'zia-data@unstop.test' }, include: { memberships: true } })
    const orgId = zia?.memberships[0]?.organizationId
    org = orgId ? await db.organization.findUnique({ where: { id: orgId } }) : null
  }
  if (!org) org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!org) throw new Error('No organization found')
  console.log(`Org: ${org.name} (${org.id})`)

  const admin = await db.user.findFirst({
    where: { memberships: { some: { organizationId: org.id, isActive: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) throw new Error('No admin user in org')

  let createdWf = 0
  let createdExec = 0
  for (const spec of SPECS) {
    // Upsert the rule by (organizationId, name).
    const existing = await db.workflowRule.findFirst({ where: { organizationId: org.id, name: spec.name } })
    const rule = existing
      ? await db.workflowRule.update({
          where: { id: existing.id },
          data: {
            triggerType: spec.triggerType,
            triggerModel: spec.triggerModel,
            triggerConditions: JSON.stringify(spec.triggerConditions),
            isActive: spec.isActive,
          },
        })
      : await db.workflowRule.create({
          data: {
            organizationId: org.id,
            name: spec.name,
            triggerType: spec.triggerType,
            triggerModel: spec.triggerModel,
            triggerConditions: JSON.stringify(spec.triggerConditions),
            isActive: spec.isActive,
            createdById: admin.id,
          },
        })
    if (!existing) createdWf++

    // Actions: only seed when the rule has none (preserve user edits).
    const actionCount = await db.workflowAction.count({ where: { ruleId: rule.id } })
    if (actionCount === 0) {
      for (let i = 0; i < spec.actions.length; i++) {
        await db.workflowAction.create({
          data: {
            organizationId: org.id,
            ruleId: rule.id,
            order: i + 1,
            actionType: spec.actions[i].actionType,
            config: JSON.stringify(spec.actions[i].config),
          },
        })
      }
    }

    // Executions: only seed when the rule has none, so user activity is kept.
    const execCount = await db.workflowExecution.count({ where: { ruleId: rule.id } })
    if (execCount === 0) {
      let runs = 0
      let errors = 0
      let lastRunAt: Date | null = null
      for (const ex of spec.executions) {
        const startedAt = new Date(Date.now() - ex.daysAgo * 86400000 - 3600000)
        const completedAt = ex.status === 'running' ? null : new Date(startedAt.getTime() + 45000)
        await db.workflowExecution.create({
          data: {
            organizationId: org.id,
            ruleId: rule.id,
            targetModule: ex.targetModule,
            targetId: ex.targetId,
            status: ex.status,
            startedAt,
            completedAt,
            errorMessage: ex.errorMessage ?? null,
            actionsExecuted: JSON.stringify(ex.actionsExecuted),
          },
        })
        createdExec++
        if (ex.status !== 'running') runs++
        if (ex.status === 'failed') errors++
        if (!lastRunAt || startedAt > lastRunAt) lastRunAt = startedAt
      }
      await db.workflowRule.update({
        where: { id: rule.id },
        data: { runCount: runs, errorCount: errors, lastRunAt },
      })
    }

    console.log(`  ${spec.name}: ${spec.actions.length} actions, ${spec.executions.length} executions seeded (active=${spec.isActive})`)
  }

  console.log(`Created ${createdWf} workflow(s), ${createdExec} execution(s). DONE`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
