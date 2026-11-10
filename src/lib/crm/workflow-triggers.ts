import { db } from '@/lib/db'
import { runRuleActions } from '@/lib/workflow/handler'

/**
 * Workflow trigger firing + shared condition evaluation.
 *
 * `fireWorkflowTriggers` is the single entry point the CRM save flow calls
 * after a record is created/updated. It is BEST-EFFORT by design: every layer
 * is wrapped so a broken rule can never break the record save itself.
 *
 * This module runs INSIDE a request context (session available), so the
 * notification/email helpers invoked by workflow actions work as usual.
 * It must never be imported by client components.
 */

// ---------------------------------------------------------------------------
// Condition model
// ---------------------------------------------------------------------------

export interface WorkflowConditionRow {
  field: string
  operator: string
  value: string | string[]
}

export interface WorkflowConditionConfig {
  rows?: WorkflowConditionRow[]
  logic?: 'AND' | 'OR'
  /** date_based trigger config */
  dateField?: string
  offsetDays?: number
  direction?: 'before' | 'after'
  /** field_change watched field (Trigger-tab select writes here) */
  field?: string
  [key: string]: unknown
}

/** Safe-parse a WorkflowRule.triggerConditions JSON string. Never throws. */
export function parseTriggerConditions(raw: unknown): WorkflowConditionConfig {
  if (!raw) return {}
  try {
    if (typeof raw === 'object') return raw as WorkflowConditionConfig
    const parsed = JSON.parse(String(raw))
    return parsed && typeof parsed === 'object' ? (parsed as WorkflowConditionConfig) : {}
  } catch {
    return {}
  }
}

const DAY_MS = 86_400_000

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** End of the local day N days from today (negative = past). */
function dayWindow(offsetDays: number): { start: Date; end: Date } {
  const start = startOfToday()
  start.setDate(start.getDate() + offsetDays)
  const end = new Date(start.getTime() + DAY_MS - 1)
  return { start, end }
}

function toStr(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

/** String normalization used for change detection (handles Dates + objects). */
function normalizeForCompare(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * Evaluate ONE condition row against a record. Any parse failure / missing
 * field / bad value → false. Never throws.
 */
export function evaluateConditionRow(row: unknown, record: Record<string, unknown> | null | undefined): boolean {
  try {
    const r = row as Partial<WorkflowConditionRow> | null
    if (!r || typeof r.field !== 'string' || !r.field) return false
    if (typeof r.operator !== 'string' || !r.operator) return false
    if (!record || typeof record !== 'object') return false
    if (!(r.field in record) || record[r.field] == null) return false

    const raw = record[r.field]
    const val = toStr(raw)
    const operand = r.value
    const operandStr = toStr(operand)
    const operandList = Array.isArray(operand)
      ? operand.map(toStr)
      : operandStr.split(',').map((s) => s.trim()).filter(Boolean)

    switch (r.operator) {
      // --- picklist / text shared ---
      case 'is':
        return (Array.isArray(operand) ? operand.map(toStr) : [operandStr]).some((t) => t === val)
      case 'is_not':
        return !(Array.isArray(operand) ? operand.map(toStr) : [operandStr]).some((t) => t === val)
      case 'is_any_of':
        return operandList.includes(val)

      // --- numbers / percents ---
      case 'equals':
      case 'greater_than':
      case 'less_than':
      case 'between': {
        const num = typeof raw === 'number' ? raw : Number(val)
        if (!Number.isFinite(num)) return false
        if (r.operator === 'equals') { const n = Number(operandStr); return Number.isFinite(n) && num === n }
        if (r.operator === 'greater_than') { const n = Number(operandStr); return Number.isFinite(n) && num > n }
        if (r.operator === 'less_than') { const n = Number(operandStr); return Number.isFinite(n) && num < n }
        // between — value format "min,max"
        const [minS, maxS] = operandStr.split(',').map((s) => s.trim())
        const min = Number(minS)
        const max = Number(maxS)
        if (!Number.isFinite(min) || !Number.isFinite(max)) return false
        return num >= min && num <= max
      }

      // --- dates ---
      case 'is_today': {
        const d = toDate(raw)
        if (!d) return false
        const { start, end } = dayWindow(0)
        return d.getTime() >= start.getTime() && d.getTime() <= end.getTime()
      }
      case 'is_before': {
        const d = toDate(raw)
        const c = toDate(operandStr)
        if (!d || !c) return false
        const cStart = new Date(c); cStart.setHours(0, 0, 0, 0)
        return d.getTime() < cStart.getTime()
      }
      case 'is_after': {
        const d = toDate(raw)
        const c = toDate(operandStr)
        if (!d || !c) return false
        const cEnd = new Date(c); cEnd.setHours(23, 59, 59, 999)
        return d.getTime() > cEnd.getTime()
      }
      case 'is_overdue': {
        // The record date is overdue when it falls before today's start.
        const d = toDate(raw)
        if (!d) return false
        return d.getTime() < startOfToday().getTime()
      }
      case 'is_before_days_ago': {
        // Relative date: record date < startOfToday − X days (older than X days ago).
        // Null/invalid record dates or non-numeric X fail safely (no match, no throw).
        const d = toDate(raw)
        const days = Number(operandStr)
        if (!d || !Number.isFinite(days)) return false
        const cutoff = startOfToday().getTime() - Math.trunc(days) * DAY_MS
        return d.getTime() < cutoff
      }

      // --- text ---
      case 'contains':
        return val.toLowerCase().includes(operandStr.toLowerCase())
      case 'does_not_contain':
        return !val.toLowerCase().includes(operandStr.toLowerCase())

      default:
        return false
    }
  } catch {
    return false
  }
}

/**
 * Shared condition evaluator. `config` without a usable `rows` array (legacy
 * `{}`) matches everything — preserving today's match-all behavior.
 */
export function evaluateConditions(
  config: WorkflowConditionConfig | null | undefined,
  record: Record<string, unknown> | null | undefined,
): boolean {
  try {
    const rows = Array.isArray(config?.rows) ? (config?.rows as WorkflowConditionRow[]) : []
    if (rows.length === 0) return true // legacy {} / empty rows = match all
    const logic = config?.logic === 'OR' ? 'OR' : 'AND'
    return logic === 'OR'
      ? rows.some((row) => evaluateConditionRow(row, record))
      : rows.every((row) => evaluateConditionRow(row, record))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Trigger firing
// ---------------------------------------------------------------------------

export interface FireWorkflowTriggersOpts {
  organizationId: string
  model: string
  event: 'create' | 'update'
  record: Record<string, unknown>
  previous?: Record<string, unknown>
  changedFields?: string[]
}

const CREATE_TYPES = ['record_create', 'record_create_or_update']
const UPDATE_TYPES = ['record_update', 'record_create_or_update', 'field_change']

/**
 * Fire every matching active automation for a record save. NEVER throws.
 *
 * - create → record_create / record_create_or_update rules
 * - update → record_update / record_create_or_update / field_change rules
 * - Conditions are evaluated against the NEW record (legacy {} = match all).
 * - field_change rules: watched field = triggerConditions.rows[0].field when
 *   present, else triggerConditions.field; fires only when that field actually
 *   changed (via previous snapshot or changedFields). Extra rows (beyond the
 *   first) act as AND/OR conditions on the new record.
 */
export async function fireWorkflowTriggers(opts: FireWorkflowTriggersOpts): Promise<void> {
  try {
    const { organizationId, model, event, record, previous, changedFields } = opts
    const targetId = record && record.id != null ? String(record.id) : ''
    if (!targetId || !model) return

    const types = event === 'create' ? CREATE_TYPES : UPDATE_TYPES
    let rules: Awaited<ReturnType<typeof queryRules>> = []
    try {
      rules = await queryRules(organizationId, model, types)
    } catch (e) {
      console.error('[workflow-triggers] rule query failed', e)
      return
    }

    for (const rule of rules) {
      try {
        const config = parseTriggerConditions(rule.triggerConditions)
        let shouldFire: boolean

        if (rule.triggerType === 'field_change') {
          // field_change is only meaningful on update events.
          const watched =
            (config.rows && config.rows.length > 0 && typeof config.rows[0]?.field === 'string' && config.rows[0].field) ||
            (typeof config.field === 'string' && config.field) ||
            null
          if (!watched) { shouldFire = false } else {
            let changed: boolean
            if (Array.isArray(changedFields) && changedFields.length > 0) {
              changed = changedFields.includes(watched)
            } else if (previous && typeof previous === 'object') {
              changed = normalizeForCompare(previous[watched]) !== normalizeForCompare(record[watched])
            } else {
              changed = false // nothing to compare against — never fire spuriously
            }
            shouldFire = changed
            if (shouldFire && config.rows && config.rows.length > 1) {
              // Remaining rows act as extra conditions on the new record.
              shouldFire = evaluateConditions({ ...config, rows: config.rows.slice(1) }, record)
            }
          }
        } else {
          shouldFire = evaluateConditions(config, record)
        }

        if (!shouldFire) continue
        await runRuleActions(
          rule,
          { module: model, id: targetId, record },
          { userId: rule.createdById, organizationId },
          { live: true },
        )
      } catch (e) {
        console.error('[workflow-triggers] rule execution failed', rule?.id, e)
      }
    }
  } catch (e) {
    console.error('[workflow-triggers] fireWorkflowTriggers failed', e)
  }
}

async function queryRules(organizationId: string, model: string, types: string[]) {
  return db.workflowRule.findMany({
    where: {
      organizationId,
      isActive: true,
      triggerType: { in: types },
      OR: [{ triggerModel: model }, { triggerModel: null }],
    },
    include: { actions: { orderBy: { order: 'asc' } } },
  })
}

// ---------------------------------------------------------------------------
// Date-based runner (invoked by POST /api/workflows/run-dated)
// ---------------------------------------------------------------------------

export interface DateBasedRunResult {
  rule: string
  ruleName: string
  model: string
  fired: number
  skipped: number
  error?: string
}

/**
 * Run every active date_based rule of the org once. For each rule, find the
 * records whose configured date field falls inside the target day window
 * (today ± offsetDays) that have NOT already been fired today (deduped via
 * WorkflowExecution rows), then run their actions. Never throws per-rule.
 */
export async function runDueDateBasedRules(params: {
  organizationId: string
  userId: string
}): Promise<DateBasedRunResult[]> {
  const results: DateBasedRunResult[] = []
  let rules: Awaited<ReturnType<typeof queryDateRules>> = []
  try {
    rules = await queryDateRules(params.organizationId)
  } catch (e) {
    console.error('[workflow-triggers] date rule query failed', e)
    return [{ rule: '', ruleName: '', model: '', fired: 0, skipped: 0, error: 'Could not load date-based rules' }]
  }

  const todayStart = startOfToday()

  for (const rule of rules) {
    const res: DateBasedRunResult = { rule: rule.id, ruleName: rule.name, model: rule.triggerModel ?? '', fired: 0, skipped: 0 }
    try {
      const config = parseTriggerConditions(rule.triggerConditions)
      const dateField = typeof config.dateField === 'string' ? config.dateField : ''
      const offsetRaw = Number(config.offsetDays)
      const offsetDays = Number.isFinite(offsetRaw) ? Math.trunc(offsetRaw) : 0
      const direction = config.direction === 'after' ? 'after' : 'before'

      if (!dateField) { res.error = 'No date field configured'; results.push(res); continue }
      if (!rule.triggerModel) { res.error = 'No record model configured'; results.push(res); continue }

      // Target day window: the date `offsetDays` before/after today.
      const shift = direction === 'after' ? offsetDays : -offsetDays
      const { start: windowStart, end: windowEnd } = dayWindow(shift)

      type ModelDelegate = { findMany: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]> }
      const delegate = (db as unknown as Record<string, ModelDelegate | undefined>)[rule.triggerModel]
      if (!delegate?.findMany) {
        res.error = `Unsupported record model: ${rule.triggerModel}`
        results.push(res)
        continue
      }

      let candidates: Record<string, unknown>[] = []
      // Probe the column type first (SQLite PRAGMA): Date bounds only work on
      // real DATETIME columns. Custom/date-ish mappings can land on TEXT
      // columns (e.g. a rule configured against firstName) — querying those
      // with Date objects throws and spams prisma:error every sweep even
      // though the ISO-string fallback succeeds. Choose the bounds type once.
      let columnIsDateTime: boolean | null = null
      try {
        // Prisma delegate keys are lower-case-first ("contact") while SQLite
        // DDL tables use the PascalCase model name ("Contact") — resolve the
        // real table name case-insensitively or the PRAGMA probe finds nothing.
        // $queryRaw is a TAG function in Prisma 6 (call form throws) —
        // $queryRawUnsafe takes a pre-built SQL string. The interpolation is
        // safe: triggerModel is escaped for single quotes, tableName comes
        // back from sqlite_master, dateField is never interpolated.
        const tbl = await db.$queryRawUnsafe<{ name: string }[]>(
          `SELECT name FROM sqlite_master WHERE type='table' AND lower(name) = lower('${rule.triggerModel.replace(/'/g, "''")}') LIMIT 1`
        )
        const tableName = tbl[0]?.name
        if (tableName) {
          const cols = await db.$queryRawUnsafe<{ name: string; type: string }[]>(
            `PRAGMA table_info("${tableName}")`
          )
          const colType = cols.find((c) => c.name === dateField)?.type ?? ''
          if (colType) columnIsDateTime = /date|time/i.test(colType)
        }
      } catch {
        // PRAGMA unavailable — fall through to the historical try/Date → retry/ISO path.
      }

      try {
        const useDateBounds = columnIsDateTime !== false
        candidates = await delegate.findMany({
          where: {
            organizationId: params.organizationId,
            [dateField]: useDateBounds
              ? { gte: windowStart, lte: windowEnd }
              : { gte: windowStart.toISOString(), lte: windowEnd.toISOString() },
          },
          take: 200,
        })
      } catch {
        // The column may be a String storing ISO dates (custom fields) —
        // Prisma rejects Date inputs there. Retry lexicographically with ISO
        // string bounds (valid for same-format UTC ISO strings) before
        // declaring the field unqueryable.
        try {
          candidates = await delegate.findMany({
            where: {
              organizationId: params.organizationId,
              [dateField]: { gte: windowStart.toISOString(), lte: windowEnd.toISOString() },
            },
            take: 200,
          })
        } catch {
          res.error = `Field "${dateField}" is not a queryable date on ${rule.triggerModel}`
          results.push(res)
          continue
        }
      }

      // Skip soft-deleted rows (when the model carries deletedAt).
      const live = candidates.filter((c) => !c.deletedAt)
      res.skipped += candidates.length - live.length

      // Dedup: skip records already fired for this rule today.
      if (live.length > 0) {
        const alreadyRun = await db.workflowExecution.findMany({
          where: {
            organizationId: params.organizationId,
            ruleId: rule.id,
            targetId: { in: live.map((c) => String(c.id)) },
            createdAt: { gte: todayStart },
          },
          select: { targetId: true },
        })
        const runSet = new Set(alreadyRun.map((e) => e.targetId))
        for (const candidate of live) {
          const id = String(candidate.id)
          if (runSet.has(id)) { res.skipped++; continue }
          if (!evaluateConditions(config, candidate)) { res.skipped++; continue }
          await runRuleActions(
            rule,
            { module: rule.triggerModel as string, id, record: candidate },
            { userId: params.userId, organizationId: params.organizationId },
            { live: true },
          )
          res.fired++
        }
      }
    } catch (e) {
      res.error = e instanceof Error ? e.message : 'Unknown error'
    }
    results.push(res)
  }

  return results
}

async function queryDateRules(organizationId: string) {
  return db.workflowRule.findMany({
    where: { organizationId, isActive: true, triggerType: 'date_based' },
    include: { actions: { orderBy: { order: 'asc' } } },
  })
}

// ---------------------------------------------------------------------------
// Scheduler hook (cron / job runner — runs outside any request context)
// ---------------------------------------------------------------------------

/**
 * Run due date_based rules for EVERY organization that has at least one active
 * date_based rule. Intended for the background scheduler (no session): per-org
 * runs are isolated — one failing org never blocks the others — and the fired
 * counts are summed. `runDueDateBasedRules` itself is untouched; this only
 * fans out over distinct orgs and aggregates results. Never throws.
 */
export async function runDueDateBasedWorkflowsForAllOrgs(): Promise<{ orgs: number; fired: number }> {
  let orgIds: string[] = []
  try {
    const rows = await db.workflowRule.findMany({
      where: { isActive: true, triggerType: 'date_based' },
      select: { organizationId: true },
      distinct: ['organizationId'],
    })
    orgIds = rows.map((r) => r.organizationId)
  } catch (e) {
    console.error('[workflow-triggers] date-based org query failed', e)
    return { orgs: 0, fired: 0 }
  }

  let fired = 0
  for (const organizationId of orgIds) {
    try {
      // The scheduler has no session: act as the org's longest-standing active
      // member so user-stamped actions (tasks, notifications) get a valid actor.
      // Falls back to '' (actions that need a user then fail per-action, logged).
      const actor = await db.tenantMembership.findFirst({
        where: { organizationId, isActive: true },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true },
      })
      const results = await runDueDateBasedRules({ organizationId, userId: actor?.userId ?? '' })
      fired += results.reduce((sum, r) => sum + (r.fired || 0), 0)
    } catch (e) {
      console.error('[workflow-triggers] date-based run failed for org', organizationId, e)
    }
  }

  return { orgs: orgIds.length, fired }
}
