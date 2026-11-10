import { db } from '@/lib/db'

/**
 * Permission resolution with role-hierarchy inheritance.
 * A role inherits all permissions of its parent (and ancestors).
 */
export async function resolvePermissions(roleId: string): Promise<Set<string>> {
  const perms = new Set<string>()
  let current: { id: string; permissions: string; parentId: string | null } | null =
    await db.role.findUnique({ where: { id: roleId } })
  const guard = new Set<string>()

  while (current && !guard.has(current.id)) {
    guard.add(current.id)
    for (const p of JSON.parse(current.permissions || '[]') as string[]) perms.add(p)
    if (!current.parentId) break
    current = await db.role.findUnique({ where: { id: current.parentId } })
  }
  return perms
}

export async function hasPermission(roleId: string, permission: string): Promise<boolean> {
  const perms = await resolvePermissions(roleId)
  return perms.has(permission) || perms.has('*')
}

export async function isAdmin(roleId: string): Promise<boolean> {
  return hasPermission(roleId, 'org.admin')
}
