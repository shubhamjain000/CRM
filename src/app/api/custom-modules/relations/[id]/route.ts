import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

/** DELETE /api/custom-modules/relations/:id — remove a related-list relation. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    const res = await db.customModuleRelation.deleteMany({ where: { id, organizationId: tenant.organization.id } })
    if (res.count === 0) return NextResponse.json({ error: 'Relation not found' }, { status: 404 })
    await audit({ organizationId: tenant.organization.id, actorId: session.userId, action: 'custom_module_relation.delete', targetType: 'custom_module_relation', targetId: id })
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
