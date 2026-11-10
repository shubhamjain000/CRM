import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { hasPermission } from '@/lib/auth/permissions'
import { audit } from '@/lib/auth/audit'
import {
  FIELD_CATALOG, FIELD_SECURITY_LEVELS, FIELD_SECURITY_MODELS, getFieldRulesForRole,
  invalidateFieldSecurityCache, type FieldSecurityModel,
} from '@/lib/auth/field-security'

export const dynamic = 'force-dynamic'

/** GET /api/security/field-security?roleId= — list rules for an org role (defaults to the caller's). */
export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

    const url = new URL(req.url)

    // ?mine=1 — the CALLING user's effective restrictions, per module, resolved
    // the same way the boundary wrappers (filterWritableForCaller /
    // maskRecordForCaller) resolve them. Admins always get empty arrays.
    if (url.searchParams.get('mine')) {
      const rules = await getFieldRulesForRole(tenant.role.id)
      const admin = await hasPermission(tenant.role.id, 'org.admin')
      const mine: Record<string, { hidden: string[]; readOnly: string[] }> = {}
      for (const m of FIELD_SECURITY_MODELS) {
        if (admin) {
          mine[m] = { hidden: [], readOnly: [] }
          continue
        }
        const forModel = rules[m] ?? {}
        mine[m] = {
          hidden: Object.entries(forModel).filter(([, level]) => level === 'hidden').map(([field]) => field),
          readOnly: Object.entries(forModel).filter(([, level]) => level === 'read_only').map(([field]) => field),
        }
      }
      return NextResponse.json({ mine, roleId: tenant.role.id, canManage: admin })
    }

    const requested = url.searchParams.get('roleId') ?? tenant.role.id
    const admin = await hasPermission(tenant.role.id, 'org.admin')
    if (requested !== tenant.role.id && !admin) {
      return NextResponse.json({ error: 'You can only view your own role\u2019s field rules' }, { status: 403 })
    }

    const role = await db.role.findFirst({
      where: { id: requested, organizationId: tenant.organization.id },
      select: { id: true, name: true },
    })
    if (!role) return NextResponse.json({ error: 'Role not found in your organization' }, { status: 404 })

    const rules = await db.fieldSecurity.findMany({
      where: { roleId: role.id },
      orderBy: [{ model: 'asc' }, { field: 'asc' }],
      select: { id: true, model: true, field: true, level: true },
    })
    return NextResponse.json({ role, rules, canManage: admin, catalog: FIELD_CATALOG })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

/** POST /api/security/field-security — upsert a rule (admin only). level 'visible' removes the restriction. */
export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    if (!(await hasPermission(tenant.role.id, 'org.admin'))) {
      return NextResponse.json({ error: 'Only organization admins can manage field security' }, { status: 403 })
    }

    const body = (await req.json().catch(() => null)) as {
      roleId?: string; model?: string; field?: string; level?: string
    } | null
    if (!body?.roleId || !body.model || !body.field || !body.level) {
      return NextResponse.json({ error: 'roleId, model, field and level are required' }, { status: 400 })
    }

    const role = await db.role.findFirst({
      where: { id: body.roleId, organizationId: tenant.organization.id },
      select: { id: true },
    })
    if (!role) return NextResponse.json({ error: 'Role not found in your organization' }, { status: 404 })

    const models = Object.keys(FIELD_CATALOG) as FieldSecurityModel[]
    if (!models.includes(body.model as FieldSecurityModel)) {
      return NextResponse.json({ error: 'Unknown module' }, { status: 400 })
    }
    const model = body.model as FieldSecurityModel
    if (!FIELD_CATALOG[model].includes(body.field)) {
      return NextResponse.json({ error: 'Unknown field for this module' }, { status: 400 })
    }
    if (!FIELD_SECURITY_LEVELS.includes(body.level as never)) {
      return NextResponse.json({ error: 'level must be visible, read_only or hidden' }, { status: 400 })
    }

    if (body.level === 'visible') {
      // 'visible' = no restriction → remove the rule row entirely.
      await db.fieldSecurity.deleteMany({ where: { roleId: role.id, model, field: body.field } })
    } else {
      await db.fieldSecurity.upsert({
        where: { roleId_model_field: { roleId: role.id, model, field: body.field } },
        create: { roleId: role.id, model, field: body.field, level: body.level },
        update: { level: body.level },
      })
    }

    invalidateFieldSecurityCache(role.id)
    await audit({
      organizationId: tenant.organization.id,
      actorId: session.userId,
      action: 'security.fieldSecurity',
      targetType: 'role',
      targetId: role.id,
      metadata: { model, field: body.field, level: body.level },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

/** DELETE /api/security/field-security?id= — remove a rule (admin only). */
export async function DELETE(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    if (!(await hasPermission(tenant.role.id, 'org.admin'))) {
      return NextResponse.json({ error: 'Only organization admins can manage field security' }, { status: 403 })
    }

    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const rule = await db.fieldSecurity.findUnique({
      where: { id },
      select: { id: true, roleId: true, role: { select: { organizationId: true } } },
    })
    if (!rule || rule.role.organizationId !== tenant.organization.id) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    await db.fieldSecurity.delete({ where: { id } })
    invalidateFieldSecurityCache(rule.roleId)
    await audit({
      organizationId: tenant.organization.id,
      actorId: session.userId,
      action: 'security.fieldSecurity',
      targetType: 'role',
      targetId: rule.roleId,
      metadata: { deletedRuleId: id },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
