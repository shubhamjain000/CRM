import { db } from '@/lib/db'
import { ensureDefaultPipeline } from '@/lib/crm/convert'

/**
 * Provision a brand-new organization with the default role hierarchy:
 * Owner → Admin → Member. Returns the owner membership.
 */
export async function provisionOrganization(opts: {
  name: string
  slug: string
  subdomain: string
  ownerId: string
}) {
  // Ensure unique slug/subdomain by appending a short suffix if taken.
  let slug = opts.slug
  let subdomain = opts.subdomain
  for (let i = 0; i < 10; i++) {
    const exists = await db.organization.findFirst({
      where: { OR: [{ slug }, { subdomain }] },
      select: { id: true },
    })
    if (!exists) break
    const suffix = Math.random().toString(36).slice(2, 6)
    slug = `${opts.slug}-${suffix}`
    subdomain = `${opts.subdomain}-${suffix}`
  }

  const result = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: opts.name,
        slug,
        subdomain,
      },
    })

    // Role hierarchy — SENIOR inherits JUNIOR (standard RBAC): a more
    // privileged role's permission set is a superset of the less privileged
    // ones below it. resolvePermissions() walks parentId upward, so the parent
    // must point to the JUNIOR role. Created bottom-up so each parent id exists.
    //   Member  → parentId null   (own perms: [] — no inherited escalation)
    //   Admin   → parentId Member (own perms: org.admin… — inherits Member's [])
    //   Owner   → parentId Admin  (own perms: ['*'] — inherits Admin + Member)
    const memberRole = await tx.role.create({
      data: {
        organizationId: org.id,
        name: 'Member',
        description: 'Standard member access.',
        permissions: JSON.stringify([]),
        isSystem: true,
      },
    })
    const adminRole = await tx.role.create({
      data: {
        organizationId: org.id,
        name: 'Admin',
        description: 'Manage users and settings.',
        permissions: JSON.stringify(['org.admin', 'users.manage', 'roles.manage', 'audit.read']),
        parentId: memberRole.id,
        isSystem: true,
      },
    })
    const ownerRole = await tx.role.create({
      data: {
        organizationId: org.id,
        name: 'Owner',
        description: 'Full control of the organization.',
        permissions: JSON.stringify(['*']),
        parentId: adminRole.id,
        isSystem: true,
      },
    })

    const membership = await tx.tenantMembership.create({
      data: {
        userId: opts.ownerId,
        organizationId: org.id,
        roleId: ownerRole.id,
        currentOrg: true,
      },
    })

    return { org, membership, ownerRole }
  })

  // Provision the default sales pipeline + stages for the new org (Phase 3).
  await ensureDefaultPipeline(result.org.id)

  return { org: result.org, membership: result.membership, ownerRole: result.ownerRole }
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
