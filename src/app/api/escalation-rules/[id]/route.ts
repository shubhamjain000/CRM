import { NextResponse } from 'next/server'
import { deleteEscalationRule } from '@/lib/rule-engine/handler'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { db } from '@/lib/db'
export const dynamic = 'force-dynamic'

/**
 * Single escalation rule API.
 *
 * PATCH /api/escalation-rules/[id] → partial update for the rule-builder's
 *   edit form: the pre-existing fields (targetModel, timeLimitHours, action)
 *   plus the additive enrichment columns (conditions, assigneeUserId,
 *   assigneeRoleId, priority, warnAfterHours, fallbackActions, isActive).
 *   Only fields present in the body change; everything is sanitized and the
 *   row is scoped to the caller's organization. DELETE is unchanged.
 * DELETE /api/escalation-rules/[id] → delete (unchanged behavior).
 */

const ESC_MODELS = new Set(['deal', 'lead', 'contact', 'account'])
const ESC_ACTIONS = new Set(['notify', 'reassign', 'both'])
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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    // Tenant-scoped existence check — never update another org's rule.
    const existing = await db.escalationRule.findFirst({
      where: { id, organizationId: tenant.organization.id },
      select: { id: true, timeLimitHours: true },
    })
    if (!existing) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    const data: Record<string, unknown> = {}

    // --- pre-existing columns (so the edit form can change them too) ---
    if (body.targetModel !== undefined) {
      const targetModel = clampText(body.targetModel, 20)
      if (!ESC_MODELS.has(targetModel)) {
        return NextResponse.json({ error: 'targetModel must be one of deal|lead|contact|account' }, { status: 400 })
      }
      data.targetModel = targetModel
    }
    if (body.timeLimitHours !== undefined) {
      const n = Number(body.timeLimitHours)
      if (!Number.isInteger(n) || n < 1 || n > 8760) {
        return NextResponse.json({ error: 'timeLimitHours must be an integer between 1 and 8760' }, { status: 400 })
      }
      data.timeLimitHours = n
    }
    if (body.action !== undefined) {
      const action = clampText(body.action, 20)
      if (!ESC_ACTIONS.has(action)) {
        return NextResponse.json({ error: 'action must be notify|reassign|both' }, { status: 400 })
      }
      data.action = action
    }

    // --- additive enrichment columns ---
    if (body.conditions !== undefined) {
      const c = sanitizeConditions(body.conditions)
      if (c.error) return NextResponse.json({ error: c.error }, { status: 400 })
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
      if (p && !ESC_PRIORITIES.has(p)) return NextResponse.json({ error: 'priority must be low|medium|high|urgent' }, { status: 400 })
      data.priority = p || null
    }
    if (body.warnAfterHours !== undefined) {
      if (body.warnAfterHours === null || body.warnAfterHours === '') {
        data.warnAfterHours = null
      } else {
        const n = Number(body.warnAfterHours)
        if (!Number.isInteger(n) || n < 0 || n > 8760) {
          return NextResponse.json({ error: 'warnAfterHours must be an integer between 0 and 8760' }, { status: 400 })
        }
        data.warnAfterHours = n
      }
    }
    if (body.fallbackActions !== undefined) {
      const f = sanitizeFallbackActions(body.fallbackActions)
      if (f.error) return NextResponse.json({ error: f.error }, { status: 400 })
      data.fallbackActions = f.value
    }
    if (body.isActive !== undefined) data.isActive = body.isActive === true

    // Cross-field check: "warn after X" must not exceed "escalate after Y".
    const warn = data.warnAfterHours !== undefined ? (data.warnAfterHours as number | null) : undefined
    const limit = data.timeLimitHours !== undefined ? (data.timeLimitHours as number) : existing.timeLimitHours
    if (typeof warn === 'number' && warn !== null && limit > 0 && warn > limit) {
      return NextResponse.json({ error: 'Warn threshold must be less than or equal to the escalation threshold' }, { status: 400 })
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
    }

    await db.escalationRule.update({ where: { id }, data: data as never })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteEscalationRule(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
