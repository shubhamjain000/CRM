import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const memberships = await db.tenantMembership.findMany({
    where: { userId: session.userId, isActive: true },
    include: { organization: true, role: true },
    orderBy: { currentOrg: 'desc' },
  })

  const orgs = await Promise.all(
    memberships.map(async (m) => {
      const membersCount = await db.tenantMembership.count({
        where: { organizationId: m.organization.id, isActive: true },
      })
      return {
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        subdomain: m.organization.subdomain,
        role: m.role.name,
        isCurrent: m.currentOrg,
        membersCount,
      }
    }),
  )

  return NextResponse.json({ organizations: orgs })
}
