import { db } from '@/lib/db'
import { getTenant } from '@/lib/auth/tenant'
import { getSession } from '@/lib/auth/session'
import { audit } from '@/lib/auth/audit'
import { maskRecordsForRead } from '@/lib/auth/field-security'
import { evaluateRule } from '@/lib/rule-engine/handler'
import {
  assertValidCsmStep, csmServerFields, contactDisplayName, runCsmStepChange,
} from '@/lib/crm/csm-workflow'
import { applyAssignmentRules, isValidOwner, recordAssignment } from '@/lib/crm/assignment'
import { fireWorkflowTriggers } from '@/lib/crm/workflow-triggers'

export type CrmModule =
  | 'lead' | 'contact' | 'account' | 'deal'
  | 'product' | 'priceBook' | 'vendor'
  | 'quote' | 'salesOrder' | 'purchaseOrder'
  | 'campaign'

interface ListParams {
  search?: string
  sort?: string
  limit?: number
  cursor?: string
  filters?: Record<string, string | string[] | undefined>
}

interface ListResult<T> {
  items: T[]
  nextCursor: string | null
  total: number
}

const DEFAULT_PAGE = 50
const MAX_PAGE = 200

/**
 * Real scalar columns of each CRM model (from prisma/schema.prisma).
 * Anything else sent by a client is silently dropped before hitting Prisma,
 * so unknown keys (e.g. a form sending `description` to Account) can never
 * cause a 500. createTenant adds organizationId/ownerId/createdById itself.
 */
export const MODULE_COLUMNS: Record<CrmModule, string[]> = {
  lead: [
    'firstName', 'lastName', 'emails', 'phones', 'company', 'title', 'leadSource',
    'leadStatus', 'rating', 'industry', 'annualRevenue', 'employees', 'website',
    'billingAddress', 'shippingAddress', 'description', 'assignedToId',
    'lastActivity', 'score',
  ],
  contact: [
    'firstName', 'lastName', 'accountId', 'title', 'emails', 'phones', 'addresses',
    'socialProfiles', 'birthday', 'department', 'assistant', 'leadSource',
    'doNotCall', 'emailOptOut', 'csmNextStep',
    // Listing Intelligence (additive) — see coerceContactListingFields below.
    'recruiterTag', 'premiumStatus', 'listingSubtype', 'totalApplications',
    'reasonableFitPct', 'reasonableScoreUsers', 'listingUrl', 'listingTitle',
    'listingCategory', 'dateApproved', 'visibility', 'hiringStatus',
    'relevantApplications', 'hiredCount', 'csmRecruiterType', 'csmStatus',
    'csmNextCallDate', 'totalReachoutsDone', 'lastReachedOutAt',
    // Zoho "Recruiter Information" form (additive) — Recruiter Information /
    // Form Details / Reachout TAT & CSM Status / Paid Plan Pitch & Details /
    // Additional Recruiter Details. modifiedById is stamped server-side.
    'typeOfLead', 'recruiterTriggers', 'company', 'employeeRange', 'linkedinUrl',
    'totalOps', 'modifiedById', 'reachoutTat', 'firstConversationAt',
    'totalConversationsHad', 'hiringRoles', 'joiningTimeline', 'otherPlatformUsed',
    'recruiterFeedback', 'paidPlanPitch', 'livePremiumOps', 'postPitchLeadType',
    'paidPlanPitchDate', 'paidPlanFeedback', 'paidPlanExpiryDate',
    'addRecruiterName', 'addRecruiterDesignation', 'addRecruiterMobile',
  ],
  account: [
    'name', 'accountNumber', 'accountType', 'industry', 'annualRevenue',
    'employees', 'website', 'billingAddress', 'shippingAddress', 'parentAccountId',
    'tickerSymbol', 'ownership', 'rating', 'sicCode', 'tags', 'pocContactId',
  ],
  deal: [
    'name', 'amount', 'currency', 'stageId', 'pipelineId', 'closeDate',
    'probability', 'accountId', 'primaryContactId', 'leadSource', 'type',
    'nextStep', 'description', 'lostReason', 'competitors', 'forecastCategory',
  ],
  product: [
    'name', 'productCode', 'category', 'unit', 'unitPrice', 'taxPercent',
    'active', 'description',
  ],
  priceBook: ['name', 'description', 'active'],
  vendor: [
    'name', 'category', 'emails', 'phones', 'website', 'address', 'description',
  ],
  // items + totals are JSON/number columns; document routes recompute totals
  // server-side from items before persisting, so client totals are overwritten.
  quote: [
    'name', 'accountId', 'contactId', 'dealId', 'status', 'validUntil', 'items',
    'subtotal', 'discountTotal', 'taxTotal', 'grandTotal', 'currency', 'terms',
    'description',
  ],
  salesOrder: [
    'name', 'accountId', 'contactId', 'dealId', 'status', 'items',
    'subtotal', 'discountTotal', 'taxTotal', 'grandTotal', 'currency', 'terms',
    'description',
  ],
  purchaseOrder: [
    'name', 'vendorId', 'status', 'items',
    'subtotal', 'discountTotal', 'taxTotal', 'grandTotal', 'currency', 'terms',
    'description',
  ],
  campaign: [
    'name', 'type', 'status', 'description', 'budget', 'expectedRevenue',
    'startDate', 'endDate', 'members', 'metrics',
  ],
}

/** System columns that must never be set directly by a client. */
const SYSTEM_COLUMNS = new Set([
  'id', 'organizationId', 'ownerId', 'createdById', 'createdAt', 'updatedAt',
  'deletedAt', 'isConverted', 'convertedAccountId', 'convertedContactId',
  'convertedDealId',
])

/**
 * Pick only whitelisted module columns from a client payload, dropping every
 * unknown key and system column (createTenant re-adds the system ones itself).
 */
function sanitizeRecordData(model: CrmModule, data: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set(MODULE_COLUMNS[model])
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (SYSTEM_COLUMNS.has(key)) continue
    if (!allowed.has(key)) continue
    out[key] = value
  }
  if (model === 'contact') coerceContactListingFields(out)
  return out
}

// ---------------------------------------------------------------------------
// Listing Intelligence coercion (contact only, additive columns only).
// Keeps the new optional columns clean no matter which client writes them:
// numbers never become NaN, dates never become Invalid Date, and
// listingCategory always stays a JSON-array-string. Every other field keeps
// its existing dumb pass-through behavior.
// ---------------------------------------------------------------------------

const CONTACT_LISTING_INTS = new Set([
  'totalApplications', 'reasonableScoreUsers', 'totalReachoutsDone', 'relevantApplications', 'hiredCount',
  // Recruiter Information form (additive)
  'totalOps', 'totalConversationsHad', 'livePremiumOps',
])
const CONTACT_LISTING_FLOATS = new Set(['reasonableFitPct'])
const CONTACT_LISTING_DATES = new Set([
  'dateApproved', 'csmNextCallDate', 'lastReachedOutAt',
  // Recruiter Information form (additive)
  'firstConversationAt', 'paidPlanPitchDate', 'paidPlanExpiryDate',
])
const CONTACT_LISTING_STRINGS = new Set([
  'recruiterTag', 'premiumStatus', 'listingSubtype', 'listingUrl',
  'listingTitle', 'csmRecruiterType', 'csmStatus', 'visibility', 'hiringStatus',
  // Recruiter Information form (additive)
  'typeOfLead', 'recruiterTriggers', 'company', 'employeeRange', 'linkedinUrl',
  'reachoutTat', 'hiringRoles', 'joiningTimeline', 'otherPlatformUsed',
  'recruiterFeedback', 'paidPlanPitch', 'postPitchLeadType', 'paidPlanFeedback',
  'addRecruiterName', 'addRecruiterDesignation', 'addRecruiterMobile',
])

function coerceListingNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  return Number.isFinite(n) ? n : null
}

function coerceListingCategory(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  let list: string[] = []
  if (Array.isArray(raw)) {
    list = raw.map((v) => String(v).trim())
  } else {
    const s = String(raw).trim()
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) list = parsed.map((v) => String(v).trim())
      else list = [s]
    } catch {
      list = [s]
    }
  }
  list = list.filter((v) => v !== '')
  return list.length > 0 ? JSON.stringify(list) : null
}

function coerceContactListingFields(data: Record<string, unknown>): void {
  for (const k of CONTACT_LISTING_INTS) {
    if (k in data) {
      const n = coerceListingNumber(data[k])
      data[k] = n === null ? null : Math.trunc(n)
    }
  }
  for (const k of CONTACT_LISTING_FLOATS) {
    if (k in data) data[k] = coerceListingNumber(data[k])
  }
  for (const k of CONTACT_LISTING_DATES) {
    if (!(k in data)) continue
    const v = data[k]
    if (v === null || v === undefined || v === '') { data[k] = null; continue }
    const d = v instanceof Date ? v : new Date(String(v))
    data[k] = Number.isNaN(d.getTime()) ? null : d
  }
  for (const k of CONTACT_LISTING_STRINGS) {
    if (!(k in data)) continue
    const v = data[k]
    if (v === null || v === undefined) { data[k] = null; continue }
    const s = String(v).trim()
    data[k] = s === '' ? null : s
  }
  if ('listingCategory' in data) data.listingCategory = coerceListingCategory(data.listingCategory)
}

// ---------------------------------------------------------------------------
// Validation rules — enforced on every create/update (Wired: rules defined in
// the Rule Builder actually block bad records instead of being cosmetic).
// ---------------------------------------------------------------------------

interface ValidationFailure {
  field: string
  message: string
}

/**
 * Evaluate all active ValidationRules for `model` against `data`.
 * - `phase` filters rules by triggerOn (create|update|both).
 * - `excludeId` excludes the current record from `unique` checks (updates).
 * - Throws an aggregated Error (severity=error rules) when any rule fails.
 */
async function runValidationRules(
  organizationId: string,
  model: CrmModule,
  data: Record<string, unknown>,
  phase: 'create' | 'update',
  excludeId?: string,
): Promise<void> {
  const rules = await db.validationRule.findMany({
    where: {
      organizationId,
      targetModel: model,
      isActive: true,
      triggerOn: { in: [phase, 'both'] },
    },
  })
  if (rules.length === 0) return

  const failures: ValidationFailure[] = []
  const delegate = db[model] as any
  const allowedColumns = new Set(MODULE_COLUMNS[model])

  for (const rule of rules) {
    if (rule.conditionType === 'unique') {
      // DB-backed uniqueness: only for whitelisted columns with a present value.
      const value = data[rule.fieldName]
      if (value === undefined || value === null || value === '' || !allowedColumns.has(rule.fieldName)) continue
      try {
        const where: Record<string, unknown> = {
          organizationId,
          [rule.fieldName]: value,
          deletedAt: null,
        }
        if (excludeId) where.id = { not: excludeId }
        const count = await delegate.count({ where })
        if (count > 0) {
          failures.push({ field: rule.fieldName, message: rule.errorMessage || `${rule.fieldName} must be unique` })
        }
      } catch {
        // Column type mismatch etc. — treat the rule as non-fatal rather than
        // blocking every save on a misconfigured rule.
      }
      continue
    }
    const outcome = evaluateRule(
      {
        conditionType: rule.conditionType,
        conditionValue: rule.conditionValue,
        fieldName: rule.fieldName,
        errorMessage: rule.errorMessage,
        errorSeverity: rule.errorSeverity,
      },
      data,
    )
    if (!outcome.valid && outcome.severity === 'error') {
      failures.push({ field: rule.fieldName, message: outcome.message || `${rule.fieldName} failed validation` })
    }
    // severity=warning rules do not block the save.
  }

  if (failures.length > 0) {
    const detail = failures.map((f) => `${f.field}: ${f.message}`).join('; ')
    throw new Error(`Validation failed — ${detail}`)
  }
}

/**
 * Zoho-style filter operator support for listTenant.
 * - DATE_FIELDS: range suffixes (_gte/_lte/_gt/_lt) are parsed as Dates.
 * - BOOLEAN_FIELDS / NUMBER_FIELDS: exact matches are coerced to the column's
 *   real Prisma type instead of staying strings.
 */
const DATE_FIELDS = new Set([
  'createdAt', 'updatedAt', 'lastActivity', 'csmNextStepAt', 'csmNextStepDueAt',
  'birthday', 'csmNextCallDate', 'dateApproved', 'lastReachedOutAt', 'closeDate', 'validUntil',
])
const BOOLEAN_FIELDS: Record<string, Set<string>> = {
  lead: new Set(['isConverted']),
  contact: new Set(['doNotCall', 'emailOptOut']),
}
const NUMBER_FIELDS: Record<string, Set<string>> = {
  lead: new Set(['score', 'annualRevenue', 'employees']),
  contact: new Set(['totalApplications', 'reasonableFitPct', 'reasonableScoreUsers', 'totalReachoutsDone']),
}
const coerceRange = (val: string, field: string): Date | number => {
  if (DATE_FIELDS.has(field)) return new Date(val)
  const n = Number(val)
  return Number.isFinite(n) ? n : new Date(val)
}

/**
 * Tenant-scoped list with cursor pagination, sorting, search, filtering.
 * Mirrors the Django backend's CursorPagination + DjangoFilterBackend + OrderingFilter.
 */
export async function listTenant<T extends { id: string; createdAt: Date }>(
  model: CrmModule,
  params: ListParams,
): Promise<ListResult<T>> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  const limit = Math.min(Math.max(Number(params.limit ?? DEFAULT_PAGE), 1), MAX_PAGE)
  const where: Record<string, unknown> = {
    organizationId: tenant.organization.id,
    deletedAt: null,
  }

  if (params.search) {
    const q = params.search
    if (model === 'lead') {
      where.OR = [
        { firstName: { contains: q } }, { lastName: { contains: q } },
        { company: { contains: q } },
      ]
    } else if (model === 'contact') {
      where.OR = [
        { firstName: { contains: q } }, { lastName: { contains: q } },
      ]
    } else if (model === 'account') {
      where.OR = [{ name: { contains: q } }, { website: { contains: q } }]
    } else {
      where.OR = [{ name: { contains: q } }]
    }
  }

  if (params.filters) {
    // Reserved query keys are pagination/sort controls, not columns — letting
    // them through made Prisma throw `Unknown argument 'sort'` on exports.
    const RESERVED = new Set(['module', 'format', 'sort', 'search', 'limit', 'cursor', 'page'])
    for (const [key, val] of Object.entries(params.filters)) {
      if (RESERVED.has(key)) continue
      if (val === undefined || val === '' || val === 'undefined') continue
      const v = val as string
      if (key.endsWith('_gte') || key.endsWith('_lte') || key.endsWith('_gt') || key.endsWith('_lt')) {
        const op = key.endsWith('_gte') ? 'gte' : key.endsWith('_lte') ? 'lte' : key.endsWith('_gt') ? 'gt' : 'lt'
        const field = key.slice(0, -(op.length + 1))
        where[field] = { ...(where[field] as object || {}), [op]: coerceRange(v, field) }
      }
      // NOTE: _not_contains must be tested before _contains (it ends with it).
      else if (key.endsWith('_not_contains')) where[key.slice(0, -13)] = { not: { contains: v } }
      else if (key.endsWith('_contains')) where[key.slice(0, -9)] = { contains: v }
      else if (key.endsWith('_starts')) where[key.slice(0, -7)] = { startsWith: v }
      else if (key.endsWith('_ne')) {
        const field = key.slice(0, -3)
        where[field] = { not: BOOLEAN_FIELDS[model]?.has(field) ? (v === 'true' || v === '1') : v }
      }
      else if (key.endsWith('_in')) where[key.slice(0, -3)] = { in: v.split(',').map((s) => s.trim()).filter(Boolean) }
      else if (BOOLEAN_FIELDS[model]?.has(key)) where[key] = v === 'true' || v === '1'
      else if (NUMBER_FIELDS[model]?.has(key) && Number.isFinite(Number(v))) where[key] = Number(v)
      else where[key] = v
    }
  }

  const orderBy: Record<string, 'asc' | 'desc'>[] = []
  if (params.sort) {
    for (const part of params.sort.split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('-')) {
        const field = mapSortField(model, trimmed.slice(1))
        if (field) orderBy.push({ [field]: 'desc' })
      } else {
        const field = mapSortField(model, trimmed)
        if (field) orderBy.push({ [field]: 'asc' })
      }
    }
  }
  if (orderBy.length === 0) orderBy.push({ createdAt: 'desc' })

  const cursorObj = params.cursor ? { id: params.cursor } : undefined

  const delegate = db[model]
  const [items, total] = await Promise.all([
    (delegate as any).findMany({
      where,
      orderBy,
      take: limit + 1,
      skip: cursorObj ? 1 : 0,
      cursor: cursorObj,
    }),
    (delegate as any).count({ where }),
  ])

  const hasMore = items.length > limit
  const sliced = hasMore ? items.slice(0, limit) : items
  // Field-level security: drop `hidden` fields for non-admin roles (no rules configured → no change).
  const masked = await maskRecordsForRead(model as string, sliced as unknown as Record<string, unknown>[], tenant.role.id)
  return {
    items: masked as unknown as T[],
    nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
    total,
  }
}

function mapSortField(model: CrmModule, field: string): string | null {
  const allowed: Record<string, string[]> = {
    lead: ['createdAt', 'updatedAt', 'lastActivity', 'leadStatus', 'rating', 'score', 'firstName', 'lastName', 'company'],
    contact: ['createdAt', 'updatedAt', 'firstName', 'lastName', 'accountId', 'csmNextStep', 'csmNextStepDueAt',
      // Listing Intelligence columns (sortable bar in the Contacts table)
      'totalApplications', 'hiredCount', 'relevantApplications', 'dateApproved'],
    account: ['createdAt', 'updatedAt', 'name', 'accountType', 'annualRevenue', 'employees'],
    deal: ['createdAt', 'updatedAt', 'amount', 'closeDate', 'probability', 'stageId', 'name'],
    product: ['createdAt', 'updatedAt', 'name', 'unitPrice', 'category'],
    priceBook: ['createdAt', 'updatedAt', 'name'],
    vendor: ['createdAt', 'updatedAt', 'name', 'category'],
    quote: ['createdAt', 'updatedAt', 'name', 'grandTotal', 'status', 'validUntil'],
    salesOrder: ['createdAt', 'updatedAt', 'name', 'grandTotal', 'status'],
    purchaseOrder: ['createdAt', 'updatedAt', 'name', 'grandTotal', 'status'],
    campaign: ['createdAt', 'updatedAt', 'name', 'budget', 'status'],
  }
  return allowed[model]?.includes(field) ? field : null
}

/**
 * Create a tenant-scoped record, auto-setting organizationId + ownerId + audit.
 *
 * Owner resolution order:
 *   1. explicit ownerId from the client — accepted only when that user is an
 *      active member of the SAME organization ('Invalid owner' otherwise);
 *   2. an active Assignment Rule for this model (round-robin / balance /
 *      territory) — the decision is recorded in AssignmentHistory;
 *   3. the creating user (default).
 */
export async function createTenant(
  model: CrmModule,
  data: Record<string, unknown>,
): Promise<{ id: string }> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  const sanitized = sanitizeRecordData(model, data)

  // Validation rules (Rule Builder) — block the create when an error-severity
  // rule fails. Runs before owner resolution so invalid records never land.
  await runValidationRules(tenant.organization.id, model, sanitized, 'create')

  // Owner resolution (see docblock). An empty string means "no preference".
  const requestedOwner = typeof data.ownerId === 'string' ? data.ownerId.trim() : ''
  let ownerId = session.userId
  let assignment: { ruleId: string | null; strategy: string | null } | null = null
  if (requestedOwner) {
    if (!(await isValidOwner(tenant.organization.id, requestedOwner))) {
      throw new Error('Invalid owner')
    }
    ownerId = requestedOwner
  } else {
    const outcome = await applyAssignmentRules({
      organizationId: tenant.organization.id,
      model,
      record: sanitized,
      fallbackOwnerId: session.userId,
    })
    if (outcome.ownerId) {
      ownerId = outcome.ownerId
      assignment = { ruleId: outcome.ruleId, strategy: outcome.strategy }
    }
  }

  const payload: Record<string, unknown> = {
    ...sanitized,
    organizationId: tenant.organization.id,
    ownerId,
  }
  if (model === 'lead') payload.createdById = session.userId

  // CSM cadence: stamp server-managed dates when a contact is created with a step.
  let csmOnCreate: { step: string; dueAt: Date | null } | null = null
  if (model === 'contact' && Object.prototype.hasOwnProperty.call(payload, 'csmNextStep')) {
    const step = assertValidCsmStep(payload.csmNextStep)
    payload.csmNextStep = step
    if (step !== 'None') {
      const fields = csmServerFields(step)
      payload.csmNextStepAt = fields.csmNextStepAt
      payload.csmNextStepDueAt = fields.csmNextStepDueAt
      csmOnCreate = { step, dueAt: fields.csmNextStepDueAt }
    }
  }

  const delegate = db[model] as any
  const record = await delegate.create({ data: payload })
  if (assignment) {
    await recordAssignment({
      organizationId: tenant.organization.id,
      ruleId: assignment.ruleId,
      recordModule: model,
      recordId: record.id,
      assignedToId: ownerId,
    })
  }
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: `${model}.create`,
    targetType: model,
    targetId: record.id,
  })
  if (csmOnCreate) {
    await runCsmStepChange({
      organizationId: tenant.organization.id,
      actorId: session.userId,
      contactId: record.id,
      contactName: contactDisplayName(data.firstName as string | undefined, data.lastName as string | undefined),
      step: csmOnCreate.step,
      dueAt: csmOnCreate.dueAt,
      previousStep: 'None',
    })
  }
  // Workflow automations (record_created / created_or_edited) — fire-and-forget
  // safe: fireWorkflowTriggers never throws, so record creation cannot break.
  await fireWorkflowTriggers({
    organizationId: tenant.organization.id,
    model,
    event: 'create',
    record: record as Record<string, unknown>,
  })
  return { id: record.id }
}

/**
 * Update a tenant-scoped record (tenant scoping prevents cross-tenant edits).
 * ownerId IS updatable — but only to an active member of the same organization
 * ('Invalid owner' otherwise), so reassignment is safe from any client.
 */
export async function updateTenant(
  model: CrmModule,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  const delegate = db[model] as any
  const payload = sanitizeRecordData(model, data)

  // "Modified By" is server-stamped on every contact write — the acting
  // session's user, never a client-supplied value.
  if (model === 'contact') {
    delete payload.modifiedById
    payload.modifiedById = session.userId
  }

  // Validation rules (Rule Builder). For updates, validate against the MERGED
  // record (current values + payload) so `required` rules see the whole row,
  // and `unique` checks exclude this record itself.
  {
    const rules = await db.validationRule.findMany({
      where: {
        organizationId: tenant.organization.id,
        targetModel: model,
        isActive: true,
        triggerOn: { in: ['update', 'both'] },
      },
      select: { id: true },
    })
    if (rules.length > 0 && Object.keys(payload).length > 0) {
      const current = await delegate.findFirst({
        where: { id, organizationId: tenant.organization.id, deletedAt: null },
      })
      if (current) {
        const { id: _omit, organizationId: _org, ownerId: _owner, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = current as Record<string, unknown>
        await runValidationRules(tenant.organization.id, model, { ...rest, ...payload }, 'update', id)
      }
    }
  }

  // Owner reassignment (validated)
  const requestedOwner = typeof data.ownerId === 'string' ? data.ownerId.trim() : ''
  if (requestedOwner) {
    if (!(await isValidOwner(tenant.organization.id, requestedOwner))) {
      throw new Error('Invalid owner')
    }
    payload.ownerId = requestedOwner
  }

  // CSM cadence: validate the step, stamp server-managed dates on change.
  let csmChange: { step: string; dueAt: Date | null; contactName: string; previousStep: string } | null = null
  if (model === 'contact' && Object.prototype.hasOwnProperty.call(payload, 'csmNextStep')) {
    const step = assertValidCsmStep(payload.csmNextStep)
    payload.csmNextStep = step
    const current = await delegate.findFirst({
      where: { id, organizationId: tenant.organization.id, deletedAt: null },
      select: { csmNextStep: true, firstName: true, lastName: true },
    })
    if (current && current.csmNextStep !== step) {
      const fields = csmServerFields(step)
      payload.csmNextStepAt = fields.csmNextStepAt
      payload.csmNextStepDueAt = fields.csmNextStepDueAt
      csmChange = {
        step,
        dueAt: fields.csmNextStepDueAt,
        contactName: contactDisplayName(current.firstName, current.lastName),
        previousStep: current.csmNextStep,
      }
    }
  }

  // Deal stage moves MUST go through the transition engine so StageTransition
  // rules, role permissions, amount conditions, locked stages, probability /
  // forecast sync, and DealStageHistory are all enforced (previously a plain
  // PATCH silently bypassed the entire pipeline engine).
  if (model === 'deal' && typeof payload.stageId === 'string' && payload.stageId) {
    const current = await delegate.findFirst({
      where: { id, organizationId: tenant.organization.id, deletedAt: null },
      select: { stageId: true },
    })
    if (current && current.stageId !== payload.stageId) {
      const { transitionDeal } = await import('@/lib/pipeline/handler')
      const result = await transitionDeal(id, payload.stageId as string)
      if (!result.ok) throw new Error(result.error || 'Stage transition not allowed')
    }
    // The engine already applied stageId + probability + forecastCategory.
    delete payload.stageId
    delete payload.probability
    delete payload.forecastCategory
  }

  // Snapshot BEFORE the write so field_change rules see the true old values.
  let previous: Record<string, unknown> | undefined
  try {
    const before = await delegate.findFirst({
      where: { id, organizationId: tenant.organization.id, deletedAt: null },
    })
    if (before) {
      const { id: _pid, organizationId: _porg, ...rest } = before as Record<string, unknown>
      previous = rest
    }
  } catch { /* snapshot is best-effort — triggers still fire with merged data */ }

  if (Object.keys(payload).length > 0) {
    await delegate.updateMany({
      where: { id, organizationId: tenant.organization.id, deletedAt: null },
      data: payload,
    })
  }
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: `${model}.update`,
    targetType: model,
    targetId: id,
  })
  if (csmChange) {
    await runCsmStepChange({
      organizationId: tenant.organization.id,
      actorId: session.userId,
      contactId: id,
      contactName: csmChange.contactName,
      step: csmChange.step,
      dueAt: csmChange.dueAt,
      previousStep: csmChange.previousStep,
    })
  }
  // Workflow automations (record_edited / created_or_edited / field_change) —
  // previous snapshot + changed field list feed field_change rules. The
  // trigger engine never throws, so updates cannot break because of it.
  if (Object.keys(payload).length > 0) {
    await fireWorkflowTriggers({
      organizationId: tenant.organization.id,
      model,
      event: 'update',
      record: { ...(previous ?? {}), ...payload, id, ownerId: payload.ownerId ?? previous?.ownerId },
      previous,
      changedFields: Object.keys(payload),
    })
  }
}

/**
 * Soft delete (trash). Recoverable for 30 days.
 */
export async function softDeleteTenant(model: CrmModule, id: string): Promise<void> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  const delegate = db[model] as any
  await delegate.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { deletedAt: new Date() },
  })
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: `${model}.delete`,
    targetType: model,
    targetId: id,
  })
}

/**
 * Recover a soft-deleted record from trash.
 */
export async function restoreTenant(model: CrmModule, id: string): Promise<void> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  const delegate = db[model] as any
  await delegate.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { deletedAt: null },
  })
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: `${model}.restore`,
    targetType: model,
    targetId: id,
  })
}

export async function bulkDeleteTenant(model: CrmModule, ids: string[]): Promise<number> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  const delegate = db[model] as any
  const result = await delegate.updateMany({
    where: { id: { in: ids }, organizationId: tenant.organization.id },
    data: { deletedAt: new Date() },
  })
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: `${model}.bulk_delete`,
    metadata: { ids, count: result.count },
  })
  return result.count
}

export async function bulkUpdateTenant(
  model: CrmModule,
  ids: string[],
  data: Record<string, unknown>,
): Promise<number> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  const delegate = db[model] as any
  const payload = sanitizeRecordData(model, data ?? {})

  // Bulk owner reassignment (validated)
  const requestedOwner = typeof data?.ownerId === 'string' ? data.ownerId.trim() : ''
  if (requestedOwner) {
    if (!(await isValidOwner(tenant.organization.id, requestedOwner))) {
      throw new Error('Invalid owner')
    }
    payload.ownerId = requestedOwner
  }

  // Workflow triggers (additive): snapshot BEFORE the write so field_change
  // rules see the true old values, mirroring the single-record update path.
  const previousById = new Map<string, Record<string, unknown>>()
  if (Object.keys(payload).length > 0) {
    try {
      const before = (await delegate.findMany({
        where: { id: { in: ids }, organizationId: tenant.organization.id, deletedAt: null },
        take: 200,
      })) as Record<string, unknown>[]
      for (const row of before ?? []) {
        if (row && row.id != null) previousById.set(String(row.id), row)
      }
    } catch { /* snapshot is best-effort — triggers still fire with merged data */ }
  }
  // Per-row keys the write may change beyond `payload` (the bulk CSM cadence
  // path restamps csmNextStepAt / csmNextStepDueAt per contact).
  const extraKeysByRow = new Map<string, string[]>()

  let result = { count: 0 }
  if (model === 'contact' && Object.prototype.hasOwnProperty.call(payload, 'csmNextStep')) {
    // Per-row cadence change so dates + follow-up tasks stay correct per contact.
    const step = assertValidCsmStep(payload.csmNextStep)
    const targets = await delegate.findMany({
      where: { id: { in: ids.slice(0, 200) }, organizationId: tenant.organization.id, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, csmNextStep: true },
    })
    for (const c of targets) {
      const changed = c.csmNextStep !== step
      // Carry the full validated payload (e.g. a combined owner + step change).
      const rowData: Record<string, unknown> = { ...payload, csmNextStep: step }
      let dueAt: Date | null = null
      if (changed) {
        const fields = csmServerFields(step)
        rowData.csmNextStepAt = fields.csmNextStepAt
        rowData.csmNextStepDueAt = fields.csmNextStepDueAt
        dueAt = fields.csmNextStepDueAt
      } else {
        // Unchanged step: don't restamp server-managed dates.
        delete rowData.csmNextStepAt
        delete rowData.csmNextStepDueAt
      }
      extraKeysByRow.set(String(c.id), Object.keys(rowData))
      await delegate.update({ where: { id: c.id }, data: rowData })
      result = { count: result.count + 1 }
      if (changed) {
        await runCsmStepChange({
          organizationId: tenant.organization.id,
          actorId: session.userId,
          contactId: c.id,
          contactName: contactDisplayName(c.firstName, c.lastName),
          step,
          dueAt,
          previousStep: c.csmNextStep,
        })
      }
    }
  } else if (Object.keys(payload).length > 0) {
    result = await delegate.updateMany({
      where: { id: { in: ids }, organizationId: tenant.organization.id, deletedAt: null },
      data: payload,
    })
  }
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: `${model}.bulk_update`,
    metadata: { ids, count: result.count },
  })

  // Workflow triggers for bulk edits (additive): mirrors the single-update path
  // (previous snapshot + changedFields) so Record Edited / Specific Field
  // Changed / Created-or-Edited automations fire on bulk updates too. Fires per
  // updated record with ONLY the keys that actually changed for that record;
  // each call is isolated so one failing rule/record never breaks the bulk
  // operation. Update semantics and the { count } response are unchanged.
  if (Object.keys(payload).length > 0 && previousById.size > 0) {
    const norm = (v: unknown): string => {
      if (v == null) return ''
      if (v instanceof Date) return v.toISOString()
      if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return String(v) } }
      return String(v)
    }
    let updated: Record<string, unknown>[] = []
    try {
      updated = (await delegate.findMany({
        where: { id: { in: ids }, organizationId: tenant.organization.id, deletedAt: null },
        take: 200,
      })) as Record<string, unknown>[]
    } catch { updated = [] }
    for (const rec of updated ?? []) {
      try {
        if (!rec || rec.id == null) continue
        const prev = previousById.get(String(rec.id))
        if (!prev) continue
        const candidateKeys = new Set([...Object.keys(payload), ...(extraKeysByRow.get(String(rec.id)) ?? [])])
        const changedFields = Array.from(candidateKeys).filter((k) => norm(prev[k]) !== norm(rec[k]))
        if (changedFields.length === 0) continue // nothing actually changed for this row
        await fireWorkflowTriggers({
          organizationId: tenant.organization.id,
          model,
          event: 'update',
          record: rec,
          previous: prev,
          changedFields,
        })
      } catch (e) {
        console.error('[crm/handler] bulk update workflow trigger failed', e)
      }
    }
  }
  return result.count
}
