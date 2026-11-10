import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

/**
 * Related-list relations between custom modules.
 *
 * GET  /api/custom-modules/relations?parentModuleId=&childModuleId=
 *      → { relations: [{ ...rel, parentModule: {name, pluralName}, childModule: {name, pluralName} }] }
 *      Org-scoped; both query params optional.
 *
 * POST /api/custom-modules/relations
 *      {name, parentModuleId, childModuleId, childFieldApiName, type: 'one_to_many'|'many_to_many'}
 *
 * Storage contract: for one_to_many the child record's data[childFieldApiName]
 * holds the parent record id; for many_to_many it holds a JSON array of
 * parent record ids.
 */

type Json = Record<string, unknown>
const err = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) return err('Unauthorized', 401)
    const tenant = await getTenant(session.userId)
    if (!tenant) return err('No organization', 403)
    const orgId = tenant.organization.id
    const url = new URL(req.url)
    const parentModuleId = url.searchParams.get('parentModuleId')
    const childModuleId = url.searchParams.get('childModuleId')
    const relations = await db.customModuleRelation.findMany({
      where: {
        organizationId: orgId,
        ...(parentModuleId ? { parentModuleId } : {}),
        ...(childModuleId ? { childModuleId } : {}),
      },
      include: {
        parentModule: { select: { name: true, pluralName: true } },
        childModule: { select: { name: true, pluralName: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ relations })
  } catch (e) { return err(e instanceof Error ? e.message : 'Server error', 500) }
}

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return err('Unauthorized', 401)
    const tenant = await getTenant(session.userId)
    if (!tenant) return err('No organization', 403)
    const orgId = tenant.organization.id

    const body = await req.json().catch(() => null) as Json | null
    if (!body || typeof body !== 'object') return err('Invalid body')
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const parentModuleId = typeof body.parentModuleId === 'string' ? body.parentModuleId : ''
    const childModuleId = typeof body.childModuleId === 'string' ? body.childModuleId : ''
    const childFieldApiName = typeof body.childFieldApiName === 'string' ? body.childFieldApiName.trim() : ''
    const type = body.type === 'many_to_many' ? 'many_to_many' : 'one_to_many'
    if (!name || !parentModuleId || !childModuleId || !childFieldApiName) {
      return err('name, parentModuleId, childModuleId and childFieldApiName are required')
    }
    if (parentModuleId === childModuleId) return err('Parent and child module must differ')
    // both modules must belong to this org
    const mods = await db.customModule.findMany({ where: { organizationId: orgId, id: { in: [parentModuleId, childModuleId] } }, select: { id: true } })
    if (mods.length < 2) return err('Module not found', 404)
    const childField = await db.customModuleField.findFirst({ where: { moduleId: childModuleId, apiName: childFieldApiName, organizationId: orgId }, select: { id: true } })
    if (!childField) return err('Child lookup field not found on the child module', 400)

    const rel = await db.customModuleRelation.create({
      data: { organizationId: orgId, parentModuleId, childModuleId, name, childFieldApiName, type },
    })
    await audit({ organizationId: orgId, actorId: session.userId, action: 'custom_module_relation.create', targetType: 'custom_module_relation', targetId: rel.id })
    return NextResponse.json({ id: rel.id }, { status: 201 })
  } catch (e) { return err(e instanceof Error ? e.message : 'Server error', 500) }
}
