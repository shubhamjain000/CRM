import { NextResponse } from 'next/server'
import { listEscalationRules, createEscalationRule, deleteEscalationRule, listEscalationLogs } from '@/lib/rule-engine/handler'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { db } from '@/lib/db'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Additive sanitizers for the new optional EscalationRule columns. Existing
// fields (targetModel, criteria, timeLimitHours, escalateTo, action) keep
// their previous handling unchanged.
// ---------------------------------------------------------------------------

const ESC_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent'])
const ESC_CONDITION_OPERATORS = new Set(['is', 'is_not', 'greater_than'])
const ESC_FALLBACK_ACTIONS = new Set(['notify_admin', 'reassign_role', 'create_task'])
const MAX_CONDITION_ROWS = 20

const clampText = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max)

const parseJsonish = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** Trigger conditions: array of {field, operator, value} → sanitized JSON string (null when empty). */
function sanitizeConditions(raw: unknown): { value: string | null; error?: string } {
  const parsed = parseJsonish(raw)
  if (parsed === undefined) return { value: null, error: 'Invalid conditions JSON' }
  if (parsed === null) return { value: null }
  if (!Array.isArray(parsed)) return { value: null, error: 'Conditions must be an array' }
  const rows: { field: string; operator: string; value: string }[] = []
  for (const entry of parsed.slice(0, MAX_CONDITION_ROWS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    const field = clampText(e.field, 80)
    const operator = clampText(e.operator, 20)
    if (!field) continue
    if (!ESC_CONDITION_OPERATORS.has(operator)) return { value: null, error: 'Invalid condition operator' }
    rows.push({ field, operator, value: clampText(e.value, 500) })
  }
  return { value: rows.length > 0 ? JSON.stringify(rows) : null }
}

/** Fallback actions: array of known keys → JSON array string (null when empty). */
function sanitizeFallbackActions(raw: unknown): { value: string | null; error?: string } {
  const parsed = parseJsonish(raw)
  if (parsed === undefined) return { value: null, error: 'Invalid fallbackActions JSON' }
  if (parsed === null) return { value: null }
  if (!Array.isArray(parsed)) return { value: null, error: 'fallbackActions must be an array' }
  const actions = Array.from(
    new Set(parsed.filter((a): a is string => typeof a === 'string' && ESC_FALLBACK_ACTIONS.has(a.trim())).map((a) => a.trim())),
  )
  return { value: actions.length > 0 ? JSON.stringify(actions) : null }
}

const sanitizeOptionalInt = (raw: unknown, label: string): { value: number | null; error?: string } => {
  if (raw === null || raw === '') return { value: null }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > 8760) return { value: null, error: `${label} must be an integer between 0 and 8760` }
  return { value: n }
}

/**
 * Extract + sanitize ONLY the new additive columns from a request body.
 * Fields absent from the body are omitted (PATCH semantics); with
 * `defaultActive` the status switch falls back to true (POST semantics).
 */
function sanitizeEscalationExtras(body: Record<string, unknown>, opts: { defaultActive?: boolean } = {}) {
  const data: Record<string, unknown> = {}

  if (body.conditions !== undefined) {
    const c = sanitizeConditions(body.conditions)
    if (c.error) return { data, error: c.error }
    data.conditions = c.value
  }
  if (body.assigneeUserId !== undefined) {
    const v = clampText(body.assigneeUserId, 64)
    data.assigneeUserId = v || null
  }
  if (body.assigneeRoleId !== undefined) {
    const v = clampText(body.assigneeRoleId, 64)
    data.assigneeRoleId = v || null
  }
  if (body.priority !== undefined) {
    const p = clampText(body.priority, 20).toLowerCase()
    if (p && !ESC_PRIORITIES.has(p)) return { data, error: 'priority must be low|medium|high|urgent' }
    data.priority = p || null
  }
  if (body.warnAfterHours !== undefined) {
    const w = sanitizeOptionalInt(body.warnAfterHours, 'warnAfterHours')
    if (w.error) return { data, error: w.error }
    data.warnAfterHours = w.value
  }
  if (body.fallbackActions !== undefined) {
    const f = sanitizeFallbackActions(body.fallbackActions)
    if (f.error) return { data, error: f.error }
    data.fallbackActions = f.value
  }
  if (body.isActive !== undefined) {
    data.isActive = body.isActive === true
  } else if (opts.defaultActive) {
    data.isActive = true
  }

  // Cross-field check: "warn after X" must not exceed "escalate after Y".
  const limitRaw = body.timeLimitHours !== undefined ? Number(body.timeLimitHours) : undefined
  const warn = data.warnAfterHours !== undefined ? (data.warnAfterHours as number | null) : null
  if (
    warn !== null &&
    limitRaw !== undefined &&
    Number.isInteger(limitRaw) &&
    warn > limitRaw
  ) {
    return { data, error: 'Warn threshold must be less than or equal to the escalation threshold' }
  }

  return { data, error: undefined as string | undefined }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    if (url.searchParams.get('logs') === 'true') {
      const logs = await listEscalationLogs()
      return NextResponse.json({ logs })
    }
    const targetModel = url.searchParams.get('targetModel') ?? undefined
    // Opt-in: also return inactive rules (the default list stays active-only,
    // exactly as before) so the builder can show/reactivate paused rules.
    if (url.searchParams.get('includeInactive') === 'true') {
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const tenant = await getTenant(session.userId)
      if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
      const items = await db.escalationRule.findMany({
        where: { organizationId: tenant.organization.id, ...(targetModel ? { targetModel } : {}) },
        orderBy: { createdAt: 'desc' },
      })
      return NextResponse.json({ rules: items })
    }
    const items = await listEscalationRules(targetModel)
    return NextResponse.json({ rules: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.targetModel || !body?.timeLimitHours) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const extras = sanitizeEscalationExtras(body, { defaultActive: true })
    if (extras.error) return NextResponse.json({ error: extras.error }, { status: 400 })

    // Mirror the new assignee onto the legacy escalateTo JSON so older
    // consumers keep seeing {type, value} (existing column, unchanged shape).
    const escalateTo = (extras.data.assigneeUserId as string | null)
      ? { type: 'user', value: extras.data.assigneeUserId }
      : (extras.data.assigneeRoleId as string | null)
        ? { type: 'role', value: extras.data.assigneeRoleId }
        : undefined

    const r = await createEscalationRule({ ...body, ...(escalateTo ? { escalateTo } : {}) })
    if (Object.keys(extras.data).length > 0) {
      await db.escalationRule.update({ where: { id: r.id }, data: extras.data as never })
    }
    return NextResponse.json({ id: r.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
