/**
 * One-off migration: repair the INVERTED role hierarchy across all orgs.
 *
 * The original provisioning created Owner→null, Admin→Owner, Member→Admin and
 * resolvePermissions() walks parentId UPWARD — so a Member inherited Admin's
 * perms AND Owner's `*`, making every Member a full Owner (privilege
 * escalation). This script flips the links to the correct SENIOR-inherits-JUNIOR
 * direction: Member→null, Admin→Member, Owner→Admin.
 *
 * Idempotent + safe to re-run. Run: bun run scripts/fix-role-hierarchy.ts
 */
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } })
  console.log(`Repairing role hierarchy across ${orgs.length} orgs…`)
  let fixed = 0
  for (const org of orgs) {
    const roles = await db.role.findMany({
      where: { organizationId: org.id, isSystem: true },
      select: { id: true, name: true, parentId: true },
    })
    const owner = roles.find((r) => r.name === 'Owner')
    const admin = roles.find((r) => r.name === 'Admin')
    const member = roles.find((r) => r.name === 'Member')
    if (!owner || !admin || !member) continue
    // Correct direction: Member→null, Admin→Member, Owner→Admin.
    if (
      member.parentId === null &&
      admin.parentId === member.id &&
      owner.parentId === admin.id
    ) {
      continue // already correct
    }
    await db.$transaction([
      db.role.update({ where: { id: member.id }, data: { parentId: null } }),
      db.role.update({ where: { id: admin.id }, data: { parentId: member.id } }),
      db.role.update({ where: { id: owner.id }, data: { parentId: admin.id } }),
    ])
    fixed++
  }
  console.log(`Done. ${fixed} org(s) repaired, ${orgs.length - fixed} already correct.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
