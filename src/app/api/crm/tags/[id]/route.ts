import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
export const dynamic = 'force-dynamic'

/** DELETE /api/crm/tags/[id] — deletes the tag; links cascade. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    const existing = await db.tag.findFirst({
      where: { id, organizationId: tenant.organization.id },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.tag.delete({ where: { id } })
    await audit({
      organizationId: tenant.organization.id,
      actorId: session.userId,
      action: 'tag.delete',
      targetType: 'tag',
      targetId: id,
      metadata: { name: existing.name },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
