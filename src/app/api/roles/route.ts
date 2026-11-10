import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { getTenant } from '@/lib/auth/tenant'
import { hasPermission } from '@/lib/auth/permissions'
import { audit } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await getTenant(session.userId)
  if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

  const roles = await db.role.findMany({
    where: { organizationId: tenant.organization.id },
    include: { parent: true, _count: { select: { memberships: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: JSON.parse(r.permissions || '[]') as string[],
      parentId: r.parentId,
      parentName: r.parent?.name ?? null,
      isSystem: r.isSystem,
      members: r._count.memberships,
    })),
  })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await getTenant(session.userId)
  if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
  if (!(await hasPermission(tenant.role.id, 'roles.manage'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })

  const role = await db.role.create({
    data: {
      organizationId: tenant.organization.id,
      name: String(body.name),
      description: body.description ? String(body.description) : null,
      permissions: JSON.stringify(body.permissions ?? []),
      parentId: body.parentId || null,
    },
  })

  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: 'role.create',
    targetType: 'role',
    targetId: role.id,
    ip: req.headers.get('x-forwarded-for') || null,
    userAgent: req.headers.get('user-agent') || null,
    metadata: { name: role.name },
  })

  return NextResponse.json({ ok: true, roleId: role.id })
}
