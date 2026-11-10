import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { hasPermission, isAdmin } from '@/lib/auth/permissions'
import { db } from '@/lib/db'
import { audit } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/users/:id — remove a member from the current organization.
 *
 * Guards (in order):
 *  1. session + current organization + `users.manage` permission
 *  2. cannot delete yourself
 *  3. cannot delete platform superusers
 *  4. cannot delete the last Admin of the organization
 *
 * The User model has no soft-delete column, so we hard-delete the
 * organization membership and the user (all auth relations cascade in
 * schema.prisma: memberships, sessions, devices, api keys, profile, …).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await getTenant(session.userId)
  if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

  if (!(await hasPermission(tenant.role.id, 'users.manage'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  if (id === session.userId) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })
  }

  const membership = await db.tenantMembership.findUnique({
    where: { userId_organizationId: { userId: id, organizationId: tenant.organization.id } },
    include: { user: { select: { id: true, name: true, email: true, isSuperuser: true } } },
  })
  if (!membership) {
    return NextResponse.json({ error: 'User not found in this organization' }, { status: 404 })
  }
  if (membership.user.isSuperuser) {
    return NextResponse.json({ error: 'Cannot delete a superuser' }, { status: 400 })
  }

  // Last-admin guard: count active members whose role resolves `org.admin`/`*`.
  const memberships = await db.tenantMembership.findMany({
    where: { organizationId: tenant.organization.id, isActive: true },
    select: { roleId: true },
  })
  let adminCount = 0
  for (const m of memberships) {
    if (await isAdmin(m.roleId)) adminCount++
  }
  if ((await isAdmin(membership.roleId)) && adminCount <= 1) {
    return NextResponse.json({ error: 'Cannot delete the last Admin' }, { status: 400 })
  }

  await db.$transaction([
    db.tenantMembership.delete({ where: { id: membership.id } }),
    db.user.delete({ where: { id: membership.user.id } }),
  ])

  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: 'user.delete',
    targetType: 'user',
    targetId: membership.user.id,
    ip: req.headers.get('x-forwarded-for') || null,
    userAgent: req.headers.get('user-agent') || null,
    metadata: { email: membership.user.email, name: membership.user.name },
  })

  return NextResponse.json({ ok: true })
}
