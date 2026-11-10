import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { resolvePermissions } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ user: null }, { status: 401 })

  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: {
      webauthnCredentials: { select: { id: true, name: true, createdAt: true } },
      memberships: {
        include: { organization: true, role: true },
        orderBy: { currentOrg: 'desc' },
      },
    },
  })
  if (!user) return NextResponse.json({ user: null }, { status: 401 })

  const current = user.memberships.find((m) => m.currentOrg) ?? user.memberships[0]
  let permissions: string[] = []
  if (current) permissions = [...(await resolvePermissions(current.roleId))]

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      is2faEnabled: user.is2faEnabled,
      hasPasskey: user.webauthnCredentials.length > 0,
    },
    organizations: user.memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      subdomain: m.organization.subdomain,
      role: m.role.name,
      isCurrent: m.currentOrg,
      membersCount: 0,
    })),
    currentOrgId: current?.organization.id ?? null,
    permissions,
    passkeys: user.webauthnCredentials,
  })
}
