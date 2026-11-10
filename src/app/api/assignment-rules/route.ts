import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { db } from '@/lib/db'
export const dynamic = 'force-dynamic'

/**
 * Assignment rules API.
 *
 * GET  /api/assignment-rules            → ALL rules for the org (active AND
 *                                         inactive, so the UI can re-activate),
 *                                         optionally ?targetModel=lead|contact|…
 * POST /api/assignment-rules            → create with the full new format.
 *
 * Both endpoints authenticate via session + tenant (same pattern as the other
 * rule-engine routes) and scope every query to the caller's organization.
 */

const VALID_MODELS = new Set(['lead', 'contact', 'deal', 'account'])
const VALID_STRATEGIES = new Set(['round_robin', 'lead_balance', 'territory', 'custom'])
const VALID_OPERATORS = new Set([
  'is', 'is_not', 'is_any_of', 'equals', 'greater_than', 'less_than', 'between',
  'contains', 'does_not_contain', 'is_today', 'is_before', 'is_after', 'is_overdue',
])

const MAX_RULES = 200
const clampText = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max)

interface CriteriaRowSanitized {
  field: string
  operator: string
  value: string
}

/** Nested condition group: `{logic, rows}` — rows may be leaves or groups. */
interface CriteriaGroupSanitized {
  logic: string
  rows: (CriteriaRowSanitized | CriteriaGroupSanitized)[]
}

/** Deepest allowed nesting: a group inside a group (spec 3.2). */
const MAX_GROUP_DEPTH = 2
/** Abuse cap on the total number of leaf rows across all groups. */
const MAX_CRITERIA_ROWS = 50

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Sanitize ONE criteria entry (leaf row or nested group) at `depth`
 * (top-level entries = depth 1; a group must have depth ≤ MAX_GROUP_DEPTH).
 * - Leaves follow the exact pre-enhancement rules: invalid ones are DROPPED.
 * - A group must carry a string `logic` and sanitize to ≥1 row; an invalid
 *   group is REJECTED outright because silently dropping it would change the
 *   rule's semantics, and empty groups must never become hidden catch-alls.
 * Returns `{ dropped: true }` for ignorable junk, `{ error }` for rejections.
 */
function sanitizeCriteriaEntry(
  entry: unknown,
  depth: number,
  leafCount: { count: number },
): { entry?: CriteriaRowSanitized | CriteriaGroupSanitized; dropped?: boolean; error?: string } {
  if (!isPlainObject(entry)) return { dropped: true }
  const obj = entry

  // Leaf row — same validation as the pre-enhancement sanitizer (unchanged).
  if (typeof obj.field === 'string') {
    const field = clampText(obj.field, 80)
    const operator = clampText(obj.operator, 40)
    if (!field || !VALID_OPERATORS.has(operator)) return { dropped: true }
    const rawValue = obj.value
    const value = Array.isArray(rawValue)
      ? rawValue.map((v) => clampText(v, 120)).filter(Boolean).join(', ')
      : clampText(rawValue, 500)
    leafCount.count += 1
    return { entry: { field, operator, value } }
  }

  // Nested group attempt: {logic, rows}.
  if (Array.isArray(obj.rows)) {
    if (depth > MAX_GROUP_DEPTH) return { error: 'Criteria groups can be nested at most two levels deep' }
    if (typeof obj.logic !== 'string') return { error: 'Criteria groups need logic and at least one condition' }
    const logic = clampText(obj.logic, 4).toUpperCase() === 'OR' ? 'OR' : 'AND'
    const rows: (CriteriaRowSanitized | CriteriaGroupSanitized)[] = []
    for (const child of obj.rows) {
      const res = sanitizeCriteriaEntry(child, depth + 1, leafCount)
      if (res.error) return { error: res.error }
      if (res.entry) {
        if (leafCount.count > MAX_CRITERIA_ROWS) return { error: 'Too many criteria rows (max 50)' }
        rows.push(res.entry)
      }
    }
    if (rows.length === 0) return { error: 'Criteria groups need logic and at least one condition' }
    return { entry: { logic, rows } }
  }

  return { dropped: true }
}

/**
 * Sanitize criteria into its persisted JSON form:
 * - structured {rows:[(leaf|group)...], logic} when the payload has a rows
 *   array (invalid leaf rows are dropped; a rows payload with ZERO valid
 *   entries is rejected so an intended specific rule can never silently
 *   become a catch-all). Leaves keep the legacy shape byte-for-byte; groups
 *   are `{logic, rows}` nested at most two levels with ≤50 leaf rows total;
 * - legacy flat {field: value} otherwise (string keys/values, byte-compatible
 *   with the pre-enhancement engine).
 */
function sanitizeCriteria(raw: unknown): { criteria: Record<string, unknown>; error?: string } {
  if (raw === undefined || raw === null) return { criteria: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { criteria: {}, error: 'Invalid criteria' }

  const obj = raw as Record<string, unknown>
  if (Array.isArray(obj.rows)) {
    const rows: (CriteriaRowSanitized | CriteriaGroupSanitized)[] = []
    const leafCount = { count: 0 }
    for (const r of obj.rows) {
      const res = sanitizeCriteriaEntry(r, 1, leafCount)
      if (res.error) return { criteria: {}, error: res.error }
      if (res.entry) {
        if (leafCount.count > MAX_CRITERIA_ROWS) return { criteria: {}, error: 'Too many criteria rows (max 50)' }
        rows.push(res.entry)
      }
    }
    if (obj.rows.length > 0 && rows.length === 0) {
      return { criteria: {}, error: 'Criteria rows need a field and a valid operator' }
    }
    return { criteria: { rows, logic: clampText(obj.logic, 4).toUpperCase() === 'OR' ? 'OR' : 'AND' } }
  }

  // Legacy flat map — preserve pre-enhancement semantics.
  const flat: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj).slice(0, 10)) {
    const key = clampText(k, 80)
    if (!key) continue
    flat[key] = clampText(v, 500)
  }
  return { criteria: flat }
}

function sanitizeRulePayload(body: Record<string, unknown>): {
  data: Record<string, unknown>
  error?: string
} {
  const data: Record<string, unknown> = {}

  const targetModel = clampText(body.targetModel, 20)
  if (!VALID_MODELS.has(targetModel)) return { data, error: 'targetModel must be one of lead|contact|deal|account' }
  data.targetModel = targetModel

  const strategy = clampText(body.strategy, 30) || 'round_robin'
  if (!VALID_STRATEGIES.has(strategy)) {
    return { data, error: 'strategy must be round_robin|lead_balance|territory|custom' }
  }
  data.strategy = strategy

  const criteria = sanitizeCriteria(body.criteria)
  if (criteria.error) return { data, error: criteria.error }
  data.criteria = JSON.stringify(criteria.criteria)

  // Owner pool: JSON array of user ids (deduped, capped).
  const assignTo = Array.isArray(body.assignTo)
    ? Array.from(new Set(body.assignTo.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()))).slice(0, 100)
    : []
  data.assignTo = JSON.stringify(assignTo)

  if (body.assignToRole !== undefined) {
    const role = clampText(body.assignToRole, 64)
    data.assignToRole = role || null
  }
  if (body.fallbackUserId !== undefined) {
    const fb = clampText(body.fallbackUserId, 64)
    data.fallbackUserId = fb || null
  }
  if (body.territoryField !== undefined) {
    const tf = clampText(body.territoryField, 80)
    data.territoryField = tf || null
  }

  if (body.name !== undefined) {
    const name = clampText(body.name, 120)
    data.name = name || null
  }
  if (body.priority !== undefined && body.priority !== null && body.priority !== '') {
    const p = Number(body.priority)
    if (!Number.isInteger(p) || p < 0 || p > 9999) return { data, error: 'priority must be an integer between 0 and 9999' }
    data.priority = p
  } else {
    data.priority = null
  }

  data.logic = clampText(body.logic, 4).toUpperCase() === 'OR' ? 'OR' : 'AND'
  data.onlyIfUnassigned = body.onlyIfUnassigned === true
  data.notifyEmail = body.notifyEmail === true
  data.notifyInApp = body.notifyInApp === true
  data.isActive = body.isActive === undefined ? true : body.isActive === true

  return { data }
}

export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

    const url = new URL(req.url)
    const targetModel = url.searchParams.get('targetModel')
    // Inactive rules are returned too — the UI needs them for the
    // Activate/Deactivate toggle. Only rule rows of this org are exposed.
    const rules = await db.assignmentRule.findMany({
      where: {
        organizationId: tenant.organization.id,
        ...(targetModel ? { targetModel } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_RULES,
    })
    return NextResponse.json({ rules })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    const { data, error } = sanitizeRulePayload(body as Record<string, unknown>)
    if (error) return NextResponse.json({ error }, { status: 400 })

    const rule = await db.assignmentRule.create({
      data: { organizationId: tenant.organization.id, ...data } as never,
    })

    await audit({
      organizationId: tenant.organization.id,
      actorId: session.userId,
      action: 'assignment_rule.create',
      targetType: 'assignment_rule',
      targetId: rule.id,
      metadata: { name: rule.name, targetModel: rule.targetModel, strategy: rule.strategy },
    })

    return NextResponse.json({ id: rule.id, rule }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
