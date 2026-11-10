import { db } from '@/lib/db'
import { createNotification } from '@/lib/realtime/handler'
import { sendEmail } from '@/lib/email/handler'

/**
 * Owner assignment engine.
 *
 * - Org members: active tenant memberships (used by owner pickers + rule pools).
 * - Owner validation: an ownerId sent by a client is only accepted when the
 *   user is an ACTIVE member of the same organization — this closes the old
 *   hole where any id could be written cross-tenant.
 * - Assignment rules: active AssignmentRule rows (targetModel) are evaluated
 *   on record creation. Two criteria formats are supported:
 *     1. LEGACY flat map {field: value} — every entry must equal (case-
 *        insensitive) the record value; empty criteria {} = catch-all.
 *        Preserved byte-for-byte so pre-existing rules keep firing identically.
 *     2. STRUCTURED {rows: Entries[], logic: 'AND'|'OR'} — see `rowMatches`
 *        for the operator catalog. An Entry is a leaf {field, operator, value}
 *        OR a nested group {logic, rows: Entries[]} (spec 3.2); groups recurse
 *        with their own AND/OR, capped at two nesting levels by the API
 *        sanitizer. Pre-group rows arrays evaluate exactly as before.
 *        An empty group is vacuously TRUE (matches the empty-criteria
 *        catch-all semantics).
 * - Ordering: priority asc (nulls last) → criteria specificity desc →
 *   createdAt asc. A specific rule ("recruiterTag is New Recruiter") therefore
 *   always beats a catch-all ("All records") created earlier, and admins can
 *   force order with an explicit priority.
 * - Pools: rule.assignToRole → active members holding that role; else
 *   rule.assignTo ids (validated); else every active org member.
 * - Strategies: round_robin (fair rotation via AssignmentHistory counts),
 *   lead_balance (fewest OPEN records per member — deals exclude won/lost
 *   stages, the other models count non-deleted records), territory (stable
 *   hash of the territory field). A "specific user" assignment is simply
 *   round_robin with
 *   a pool of length 1 — no dedicated strategy value is needed.
 * - Extras: onlyIfUnassigned guard, trigger stats (triggerCount /
 *   lastTriggeredAt, updated in applyAssignmentRules — the single place where
 *   a rule "fires"), and best-effort in-app/email notifications.
 * - Rules never break record creation — any engine error degrades to the
 *   fallback owner.
 */

export interface OrgMember {
  id: string
  name: string
  email: string
}

export async function listOrgMembers(organizationId: string): Promise<OrgMember[]> {
  const memberships = await db.tenantMembership.findMany({
    where: { organizationId, isActive: true },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { joinedAt: 'asc' },
  })
  return memberships.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email }))
}

export async function isValidOwner(organizationId: string, userId: string): Promise<boolean> {
  if (!userId) return false
  const membership = await db.tenantMembership.findFirst({
    where: { organizationId, userId, isActive: true },
    select: { id: true },
  })
  return !!membership
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Criteria matching
// ---------------------------------------------------------------------------

/** One structured condition row (a leaf): `{field, operator, value}`. */
export interface CriteriaRow {
  field: string
  operator: string
  value?: unknown
}

/**
 * Nested condition group (spec 3.2): `{logic, rows}` where each row is again
 * a leaf or a group. Additive — a rows array without groups behaves exactly
 * as before.
 */
export interface CriteriaGroup {
  logic: string
  rows: CriteriaEntry[]
}

export type CriteriaEntry = CriteriaRow | CriteriaGroup

/** Deepest allowed group nesting: a group inside a group (API sanitizer cap). */
const MAX_GROUP_DEPTH = 2

/**
 * Shape recognizer for one criteria entry at `depth` (top-level rows = 0).
 * Leaves carry a string `field`; groups carry a string `logic` + array `rows`
 * and are accepted only while depth < MAX_GROUP_DEPTH.
 */
function isRecognizedEntry(entry: unknown, depth: number): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
  if (typeof (entry as { field?: unknown }).field === 'string') return true
  if (depth >= MAX_GROUP_DEPTH) return false
  const g = entry as { logic?: unknown; rows?: unknown }
  if (typeof g.logic !== 'string' || !Array.isArray(g.rows)) return false
  return g.rows.every((r) => isRecognizedEntry(r, depth + 1))
}

/** Type guard: is this entry a (recognized) nested group at `depth`? */
function isCriteriaGroup(entry: unknown, depth: number): entry is CriteriaGroup {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
  if (typeof (entry as { field?: unknown }).field === 'string') return false // leaf wins
  if (depth >= MAX_GROUP_DEPTH) return false
  const g = entry as { logic?: unknown; rows?: unknown }
  return typeof g.logic === 'string' && Array.isArray(g.rows)
}

/**
 * Structured criteria: `{rows: (CriteriaRow|CriteriaGroup)[], logic: 'AND'|'OR'}`.
 * Recognized conservatively — `rows` must be an array whose entries are all
 * recognizable leaves (string `field`) or well-shaped groups; otherwise the
 * criteria is treated as legacy flat. Legacy all-leaf rows arrays are
 * recognized exactly as before (unchanged outcome).
 */
function isStructuredCriteria(criteria: Record<string, unknown>): boolean {
  const rows = (criteria as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return false
  return rows.every((r) => isRecognizedEntry(r, 0))
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim())

function isNumeric(s: string): boolean {
  return s !== '' && Number.isFinite(Number(s))
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Evaluate ONE structured row against the record.
 *
 * Empty/missing record field policy (documented choice):
 *  - `is_not` / `does_not_contain` stay TRUE for empty fields — "not X" is
 *    vacuously true when there is nothing to compare, so rules like "recruiter
 *    tag is not New Recruiter" keep catching records that simply lack the tag.
 *  - every other operator is FALSE for empty fields (can't compare nothing).
 */
function rowMatches(row: CriteriaRow, record: Record<string, unknown>): boolean {
  const field = str(row.field)
  if (!field) return false
  const op = str(row.operator)
  const raw = record[field]
  const hasValue = raw !== undefined && raw !== null && str(raw) !== ''
  const actual = str(raw)
  const expected = str(row.value)
  const ci = (s: string) => s.toLowerCase()

  switch (op) {
    case 'is':
      return hasValue && ci(actual) === ci(expected)
    case 'is_not':
      if (!hasValue) return true
      return ci(actual) !== ci(expected)
    case 'is_any_of': {
      if (!hasValue) return false
      const options = Array.isArray(row.value)
        ? row.value.map((v) => ci(str(v))).filter(Boolean)
        : expected.split(',').map((s) => ci(s.trim())).filter(Boolean)
      if (options.length === 0) return false
      return options.includes(ci(actual))
    }
    case 'equals': {
      // Numeric when both sides parse as numbers, else case-insensitive string.
      if (!hasValue) return false
      if (isNumeric(actual) && isNumeric(expected)) return Number(actual) === Number(expected)
      return ci(actual) === ci(expected)
    }
    case 'greater_than':
    case 'less_than': {
      if (!hasValue || !isNumeric(actual) || !isNumeric(expected)) return false
      const a = Number(actual)
      const e = Number(expected)
      return op === 'greater_than' ? a > e : a < e
    }
    case 'between': {
      if (!hasValue) return false
      let minRaw = ''
      let maxRaw = ''
      if (Array.isArray(row.value) && row.value.length >= 2) {
        minRaw = str(row.value[0])
        maxRaw = str(row.value[1])
      } else {
        const parts = expected.split(',')
        minRaw = str(parts[0])
        maxRaw = str(parts[1])
      }
      if (!isNumeric(actual) || !isNumeric(minRaw) || !isNumeric(maxRaw)) return false
      const a = Number(actual)
      return a >= Number(minRaw) && a <= Number(maxRaw)
    }
    case 'contains':
      return hasValue && ci(actual).includes(ci(expected))
    case 'does_not_contain':
      if (!hasValue) return true
      return !ci(actual).includes(ci(expected))
    case 'is_today':
    case 'is_before':
    case 'is_after':
    case 'is_overdue': {
      // Date fields compare against TODAY's day boundaries (server-local):
      // is_today → inside today; is_before / is_overdue → before start of
      // today (overdue is an alias, per spec); is_after → from start of
      // tomorrow onwards.
      if (!hasValue) return false
      const d = toDate(raw)
      if (!d) return false
      const start = startOfToday()
      const tomorrow = new Date(start)
      tomorrow.setDate(tomorrow.getDate() + 1)
      if (op === 'is_today') return d >= start && d < tomorrow
      if (op === 'is_before' || op === 'is_overdue') return d < start
      return d >= tomorrow
    }
    default:
      return false // unknown operator → row never matches (safe degradation)
  }
}

/**
 * Evaluate ONE criteria entry (leaf row or nested group) at `depth`.
 *
 * - Leaf: evaluated by `rowMatches` exactly as before.
 * - Group: its rows are combined with the GROUP's own logic. An EMPTY group
 *   evaluates to TRUE — the same vacuous-catch-all semantics as empty
 *   top-level criteria ("no conditions = match all"), so an empty group can
 *   never silently veto its siblings.
 */
function entryMatches(entry: unknown, record: Record<string, unknown>, depth: number): boolean {
  if (isCriteriaGroup(entry, depth)) {
    if (entry.rows.length === 0) return true // empty group = vacuous catch-all
    const logic = str(entry.logic).toUpperCase() === 'OR' ? 'OR' : 'AND'
    const results = entry.rows.map((row) => entryMatches(row, record, depth + 1))
    return logic === 'OR' ? results.some(Boolean) : results.every(Boolean)
  }
  return rowMatches(entry as CriteriaRow, record)
}

/**
 * Match a rule's criteria JSON against incoming record data.
 * - Structured: all/any entries per `logic` (default AND), recursing into
 *   nested groups. Empty rows = catch-all.
 * - Legacy flat {field: value}: every entry must match case-insensitively;
 *   missing/empty record field fails; empty map {} = catch-all. Semantics are
 *   identical to the pre-enhancement engine (kept byte-for-byte).
 */
function ruleMatches(criteria: Record<string, unknown>, record: Record<string, unknown>): boolean {
  if (isStructuredCriteria(criteria)) {
    const rows = criteria.rows as CriteriaEntry[]
    if (rows.length === 0) return true // explicit empty structured criteria = catch-all
    const logic = str(criteria.logic).toUpperCase() === 'OR' ? 'OR' : 'AND'
    const results = rows.map((row) => entryMatches(row, record, 0))
    return logic === 'OR' ? results.some(Boolean) : results.every(Boolean)
  }
  // Legacy flat {field: value} — unchanged original loop.
  for (const [field, expected] of Object.entries(criteria)) {
    const actual = record[field]
    if (actual === undefined || actual === null || String(actual).trim() === '') return false
    if (String(actual).toLowerCase() !== String(expected).toLowerCase()) return false
  }
  return true
}

/** Specificity of one entry: a leaf counts 1; a group contributes the SUM of
 *  its leaves, so a deeper/more specific group ranks above a shallower one. */
function entrySpecificity(entry: unknown, depth: number): number {
  if (isCriteriaGroup(entry, depth)) {
    return entry.rows.reduce((sum, row) => sum + entrySpecificity(row, depth + 1), 0)
  }
  return 1
}

/** Criteria specificity: structured → leaf count (groups counted recursively),
 *  legacy → key count. All-leaf structured criteria still equals row count. */
function criteriaSpecificity(criteria: Record<string, unknown>): number {
  if (isStructuredCriteria(criteria)) {
    return (criteria.rows as unknown[]).reduce<number>((sum, row) => sum + entrySpecificity(row, 0), 0)
  }
  return Object.keys(criteria).length
}

// ---------------------------------------------------------------------------
// Notifications (best-effort — failures are logged, never thrown)
// ---------------------------------------------------------------------------

const STRATEGY_LABELS: Record<string, string> = {
  round_robin: 'Round Robin',
  lead_balance: 'Load Balanced',
  territory: 'Territory',
  custom: 'Custom',
}

export interface AssignmentRuleSnapshot {
  id: string
  name?: string | null
  strategy: string
  /** targetModel of the rule (kept optional for older callers). */
  model?: string
  notifyEmail?: boolean
  notifyInApp?: boolean
}

/**
 * In-process double-notify guard. applyAssignmentRules auto-notifies (it has
 * no record id, so without targetId) for the crm/handler path; recordAssignment
 * / notifyAssignment notify WITH the record id when callers pass a snapshot.
 * If both happen for the same rule+assignee within the TTL the second call is
 * skipped. Map is size-capped to stay memory-safe in long-lived processes.
 */
const NOTIFY_DEDUPE_TTL_MS = 15_000
const recentNotifies = new Map<string, number>()

function markNotified(key: string): void {
  if (recentNotifies.size > 500) {
    const cutoff = Date.now() - NOTIFY_DEDUPE_TTL_MS
    for (const [k, t] of recentNotifies) if (t < cutoff) recentNotifies.delete(k)
  }
  recentNotifies.set(key, Date.now())
}

function wasJustNotified(key: string): boolean {
  const t = recentNotifies.get(key)
  if (!t) return false
  if (Date.now() - t > NOTIFY_DEDUPE_TTL_MS) {
    recentNotifies.delete(key)
    return false
  }
  return true
}

interface NotifyInput {
  organizationId: string
  rule: AssignmentRuleSnapshot
  assignedToId: string
  recordModule: string
  recordId?: string | null
}

async function sendAssignmentNotifications(input: NotifyInput): Promise<void> {
  const { organizationId, rule, assignedToId, recordModule, recordId } = input
  const ruleName = rule.name || STRATEGY_LABELS[rule.strategy] || rule.strategy
  const moduleLabel = recordModule || rule.model || 'record'

  if (rule.notifyInApp) {
    await createNotification({
      verb: 'assignment_rule',
      recipientId: assignedToId,
      targetModule: recordModule || rule.model || undefined,
      ...(recordId ? { targetId: recordId } : {}),
      targetName: `${moduleLabel} · ${STRATEGY_LABELS[rule.strategy] ?? rule.strategy}`,
      data: { ruleId: rule.id, ruleName },
    })
  }

  if (rule.notifyEmail) {
    const membership = await db.tenantMembership.findFirst({
      where: { organizationId, userId: assignedToId, isActive: true },
      include: { user: { select: { name: true, email: true } } },
    })
    const email = membership?.user.email
    if (email) {
      await sendEmail({
        to: [email],
        subject: 'New record assigned to you',
        bodyHtml:
          `<p>Hi ${membership?.user.name || 'there'},</p>` +
          `<p>A new <b>${moduleLabel}</b> record has been assigned to you by the assignment rule ` +
          `<b>"${ruleName}"</b>.</p>` +
          `<p>Open your workspace to review the record and its next step.</p>`,
        relatedModule: recordModule || undefined,
        relatedId: recordId || undefined,
      })
    }
  }
}

/**
 * Fire notifications for a rule-driven assignment (with the real record id).
 * Exported for API routes that assign via a rule and know the record id.
 * Best-effort: any failure is logged and swallowed.
 */
export async function notifyAssignment(input: {
  organizationId: string
  recordModule: string
  recordId: string
  assignedToId: string
  rule: AssignmentRuleSnapshot
}): Promise<void> {
  try {
    const key = `${input.rule.id}:${input.assignedToId}`
    if (wasJustNotified(key)) return // already auto-notified by the engine
    await sendAssignmentNotifications(input)
    markNotified(key)
  } catch (e) {
    console.warn('[assignment] notification failed:', e instanceof Error ? e.message : e)
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface AssignmentOutcome {
  ownerId: string | null
  ruleId: string | null
  strategy: string | null
}

/** Fire-and-forget trigger stats. Awaiting inside try/catch keeps the write
 *  reliable while guaranteeing a stats failure can never break assignment. */
async function bumpTriggerStats(ruleId: string): Promise<void> {
  try {
    await db.assignmentRule.update({
      where: { id: ruleId },
      data: { triggerCount: { increment: 1 }, lastTriggeredAt: new Date() },
    })
  } catch (e) {
    console.warn('[assignment] trigger stats update failed:', e instanceof Error ? e.message : e)
  }
}

/**
 * Evaluate the active assignment rules for a model against incoming record
 * data. Returns the chosen owner (validated member) or null when no rule
 * matched / the engine could not pick. Does NOT write AssignmentHistory —
 * callers do that after the record exists (they own the real record id).
 *
 * Ordering: priority asc (NULLs last) → specificity desc → createdAt asc,
 * which preserves the specific-before-catch-all guarantee for legacy rules.
 */
export async function applyAssignmentRules(opts: {
  organizationId: string
  model: string
  record: Record<string, unknown>
  fallbackOwnerId: string
}): Promise<AssignmentOutcome> {
  const { organizationId, model, record, fallbackOwnerId } = opts
  try {
    const rules = await db.assignmentRule.findMany({
      where: { organizationId, targetModel: model, isActive: true },
      orderBy: { createdAt: 'asc' },
    })

    // Rules carrying onlyIfUnassigned are skipped when the record already has
    // an owner. `record.ownerId` is present only when the caller received one
    // (crm/handler passes sanitized record data); absent = unassigned.
    const currentOwner = str(record.ownerId)

    const sorted = [...rules].sort((a, b) => {
      const pa = a.priority ?? Number.POSITIVE_INFINITY
      const pb = b.priority ?? Number.POSITIVE_INFINITY
      if (pa !== pb) return pa - pb
      const sa = criteriaSpecificity(parseJson(a.criteria))
      const sb = criteriaSpecificity(parseJson(b.criteria))
      if (sa !== sb) return sb - sa
      return a.createdAt.getTime() - b.createdAt.getTime()
    })

    for (const rule of sorted) {
      if (rule.onlyIfUnassigned && currentOwner !== '') continue
      const criteria = parseJson(rule.criteria)
      if (!ruleMatches(criteria, record)) continue

      // Pool resolution: role pool → explicit assignTo ids → all members.
      let pool: string[] = []
      const roleId = str(rule.assignToRole)
      if (roleId) {
        const memberships = await db.tenantMembership.findMany({
          where: { organizationId, isActive: true, roleId },
          select: { userId: true },
        })
        pool = memberships.map((m) => m.userId)
      } else {
        pool = parseStringArray(rule.assignTo)
        if (pool.length > 0) {
          const valid = await Promise.all(pool.map((id) => isValidOwner(organizationId, id)))
          pool = pool.filter((_, i) => valid[i])
        }
      }
      if (pool.length === 0) {
        pool = (await listOrgMembers(organizationId)).map((m) => m.id)
      }
      if (pool.length === 0) continue

      let ownerId: string | null = null
      if (rule.strategy === 'lead_balance') {
        // "Fewest OPEN records wins" per target model. If a model cannot be
        // counted safely, degrade to the pre-existing behavior (first pool
        // member) instead of throwing — assignment must never break creation.
        const delegate: any | null = model === 'lead' ? db.lead : model === 'contact' ? db.contact : null
        if (delegate) {
          // lead/contact: no meaningful closed state — count non-deleted (as before).
          const counts = await Promise.all(
            pool.map((id) => delegate.count({ where: { organizationId, ownerId: id, deletedAt: null } })),
          )
          ownerId = pool[counts.indexOf(Math.min(...counts))]
        } else if (model === 'deal') {
          // deal: open = non-deleted AND stage neither won nor lost (Stage
          // carries isWonStage/isLostStage — relation filter on the join).
          try {
            const counts = await Promise.all(
              pool.map((id) =>
                db.deal.count({
                  where: {
                    organizationId,
                    ownerId: id,
                    deletedAt: null,
                    stage: { is: { isWonStage: false, isLostStage: false } },
                  },
                }),
              ),
            )
            ownerId = pool[counts.indexOf(Math.min(...counts))]
          } catch {
            ownerId = pool[0]
          }
        } else if (model === 'account') {
          // account: plain non-deleted count.
          try {
            const counts = await Promise.all(
              pool.map((id) => db.account.count({ where: { organizationId, ownerId: id, deletedAt: null } })),
            )
            ownerId = pool[counts.indexOf(Math.min(...counts))]
          } catch {
            ownerId = pool[0]
          }
        } else {
          ownerId = pool[0]
        }
      } else if (rule.strategy === 'territory') {
        const field = rule.territoryField || 'company'
        const key = String(record[field] ?? '').trim()
        if (!key) continue // no territory value → let the next rule decide
        let hash = 0
        for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
        ownerId = pool[hash % pool.length]
      } else {
        // round_robin (also covers "specific user" pools of length 1 and
        // `custom`) — fair rotation: least-picked in this rule's history.
        const counts = await db.assignmentHistory.groupBy({
          by: ['assignedToId'],
          where: { organizationId, ruleId: rule.id, assignedToId: { in: pool } },
          _count: true,
        })
        const countMap = new Map(counts.map((c) => [c.assignedToId, c._count]))
        ownerId = pool.reduce(
          (best, id) => ((countMap.get(id) ?? 0) < (countMap.get(best) ?? 0) ? id : best),
          pool[0],
        )
      }

      if (!ownerId || !(await isValidOwner(organizationId, ownerId))) {
        const fallback = rule.fallbackUserId || fallbackOwnerId
        ownerId = (await isValidOwner(organizationId, fallback)) ? fallback : null
      }
      if (ownerId) {
        // Trigger stats live HERE (documented single place): this is where a
        // rule genuinely fires. recordAssignment only replays the decision.
        await bumpTriggerStats(rule.id)
        if (rule.notifyInApp || rule.notifyEmail) {
          // Engine has no record id → notify without targetId (per spec).
          try {
            const key = `${rule.id}:${ownerId}`
            if (!wasJustNotified(key)) {
              await sendAssignmentNotifications({
                organizationId,
                rule: {
                  id: rule.id,
                  name: rule.name,
                  strategy: rule.strategy,
                  model,
                  notifyEmail: rule.notifyEmail,
                  notifyInApp: rule.notifyInApp,
                },
                assignedToId: ownerId,
                recordModule: model,
                recordId: null,
              })
              markNotified(key)
            }
          } catch (e) {
            console.warn('[assignment] notification failed:', e instanceof Error ? e.message : e)
          }
        }
        return { ownerId, ruleId: rule.id, strategy: rule.strategy }
      }
    }
  } catch {
    // Assignment rules are an enhancement — never let them break creation.
  }
  return { ownerId: null, ruleId: null, strategy: null }
}

/**
 * Record an assignment decision (called after the record exists).
 * Optional `ruleSnapshot` enables notifications WITH the real record id for
 * callers that have one; the crm/handler caller omits it (the engine already
 * notified — the dedupe guard makes double-passing harmless anyway).
 */
export async function recordAssignment(input: {
  organizationId: string
  ruleId: string | null
  recordModule: string
  recordId: string
  assignedToId: string
  ruleSnapshot?: {
    notifyEmail: boolean
    notifyInApp: boolean
    name?: string | null
    strategy: string
    model?: string
  }
}): Promise<void> {
  try {
    await db.assignmentHistory.create({
      data: {
        organizationId: input.organizationId,
        ruleId: input.ruleId,
        recordModule: input.recordModule,
        recordId: input.recordId,
        assignedToId: input.assignedToId,
      },
    })
  } catch {
    // History is observability — never break the write path.
  }
  if (input.ruleSnapshot && input.ruleId && (input.ruleSnapshot.notifyEmail || input.ruleSnapshot.notifyInApp)) {
    await notifyAssignment({
      organizationId: input.organizationId,
      recordModule: input.recordModule,
      recordId: input.recordId,
      assignedToId: input.assignedToId,
      rule: { id: input.ruleId, ...input.ruleSnapshot },
    })
  }
}
