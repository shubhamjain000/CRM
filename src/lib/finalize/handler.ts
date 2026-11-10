import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { hasPermission } from '@/lib/auth/permissions'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

/**
 * Org-wide audit log browse. Requires the `audit.read` permission (same gate
 * as /api/audit) — otherwise any org member could read the full audit trail.
 */
export async function listAuditLog(opts: { action?: string; targetType?: string; targetId?: string; limit?: number } = {}) {
  const { tenant } = await ctx()
  if (!(await hasPermission(tenant.role.id, 'audit.read')) && !(await hasPermission(tenant.role.id, 'org.admin'))) {
    throw new Error('Forbidden')
  }
  return db.auditLogEntry.findMany({
    where: {
      organizationId: tenant.organization.id,
      ...(opts.action ? { action: { contains: opts.action } } : {}),
      ...(opts.targetType ? { targetType: opts.targetType } : {}),
      ...(opts.targetId ? { targetId: opts.targetId } : {}),
    },
    orderBy: { timestamp: 'desc' },
    take: opts.limit ?? 100,
  })
}

/**
 * Record-level audit history. Open to any org member who can already see the
 * record — this is a per-record feature, not org-wide audit browse.
 */
export async function getRecordAudit(targetType: string, targetId: string) {
  const { tenant } = await ctx()
  return db.auditLogEntry.findMany({
    where: { organizationId: tenant.organization.id, targetType, targetId },
    orderBy: { timestamp: 'desc' },
    take: 200,
  })
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

const COMPLIANCE_FRAMEWORKS = [
  { name: 'SOC 2 Type II', items: ['Access controls implemented', 'Encryption at rest', 'Encryption in transit', 'Audit logging enabled', 'Incident response plan', 'Data retention policy', 'Vendor management', 'Change management'] },
  { name: 'GDPR', items: ['Data processing notice', 'Consent management', 'Right to access', 'Right to erasure', 'Data portability', 'DPO appointed', 'Data residency (EU)', 'Breach notification process'] },
  { name: 'DPDP Act (India)', items: ['Data processing notice', 'Consent management', 'Data principal rights', 'Grievance officer appointed', 'Data breach response', 'Data retention schedule'] },
  { name: 'CCPA', items: ['Privacy policy updated', 'Opt-out mechanism', 'Right to delete', 'Right to know', 'Non-discrimination notice'] },
  { name: 'ISO 27001', items: ['ISMS established', 'Risk assessment', 'Security controls', 'Access management', 'Cryptographic controls', 'Physical security', 'Business continuity'] },
]

export async function getComplianceChecklist() {
  const { tenant } = await ctx()
  let items = await db.complianceChecklistItem.findMany({
    where: { organizationId: tenant.organization.id },
    take: 500,
  })
  if (items.length === 0) {
    // Auto-create default checklist (single batched insert)
    await db.complianceChecklistItem.createMany({
      data: COMPLIANCE_FRAMEWORKS.flatMap((fw) =>
        fw.items.map((item) => ({ organizationId: tenant.organization.id, framework: fw.name, item, status: 'pending' })),
      ),
    })
    items = await db.complianceChecklistItem.findMany({ where: { organizationId: tenant.organization.id }, take: 500 })
  }
  // Group by framework
  const grouped: Record<string, { total: number; met: number; items: any[] }> = {}
  for (const item of items) {
    if (!grouped[item.framework]) grouped[item.framework] = { total: 0, met: 0, items: [] }
    grouped[item.framework].total++
    if (item.status === 'met') grouped[item.framework].met++
    grouped[item.framework].items.push(item)
  }
  return grouped
}

export async function updateComplianceItem(id: string, status: string, evidence?: string) {
  const { tenant } = await ctx()
  await db.complianceChecklistItem.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { status, evidence },
  })
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

const ONBOARDING_STEPS = [
  { step: 'create_org', label: 'Organization created' },
  { step: 'select_industry', label: 'Select industry' },
  { step: 'import_data', label: 'Import data' },
  { step: 'connect_email', label: 'Connect email' },
  { step: 'connect_calendar', label: 'Connect calendar' },
  { step: 'invite_team', label: 'Invite team members' },
  { step: 'setup_pipeline', label: 'Set up pipeline' },
  { step: 'create_first_deal', label: 'Create first deal' },
]

export async function getOnboardingProgress() {
  const { session, tenant } = await ctx()
  let steps = await db.onboardingStep.findMany({
    where: { organizationId: tenant.organization.id, userId: session.userId },
  })
  if (steps.length === 0) {
    // Auto-complete create_org
    await db.onboardingStep.create({
      data: { organizationId: tenant.organization.id, userId: session.userId, step: 'create_org', isCompleted: true, completedAt: new Date() },
    })
    steps = await db.onboardingStep.findMany({ where: { organizationId: tenant.organization.id, userId: session.userId } })
  }
  const completedSteps = new Set(steps.filter(s => s.isCompleted).map(s => s.step))
  return ONBOARDING_STEPS.map(s => ({
    ...s,
    isCompleted: completedSteps.has(s.step),
  }))
}

export async function completeOnboardingStep(step: string) {
  const { session, tenant } = await ctx()
  await db.onboardingStep.upsert({
    where: { organizationId_userId_step: { organizationId: tenant.organization.id, userId: session.userId, step } },
    create: { organizationId: tenant.organization.id, userId: session.userId, step, isCompleted: true, completedAt: new Date() },
    update: { isCompleted: true, completedAt: new Date() },
  })
}

// ---------------------------------------------------------------------------
// System Health
// ---------------------------------------------------------------------------

export async function getSystemHealth() {
  const { tenant } = await ctx()
  const orgId = tenant.organization.id
  const [totalUsers, totalLeads, totalDeals, totalActivities, totalStorage, auditEvents24h] = await Promise.all([
    db.tenantMembership.count({ where: { organizationId: orgId, isActive: true } }),
    db.lead.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.deal.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.activity.count({ where: { organizationId: orgId } }),
    db.file.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.auditLogEntry.count({ where: { organizationId: orgId, timestamp: { gte: new Date(Date.now() - 86400000) } } }),
  ])
  return {
    users: totalUsers,
    leads: totalLeads,
    deals: totalDeals,
    activities: totalActivities,
    files: totalStorage,
    auditEvents24h,
    status: 'healthy' as const,
    uptime: process.uptime ? `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m` : 'N/A',
  }
}
