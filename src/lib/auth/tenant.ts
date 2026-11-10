import { db } from '@/lib/db'

/**
 * Resolve the tenant context for a request. In the sandbox we don't have
 * subdomains, so we use the user's currentOrg from their session membership.
 * In the Django backend this is resolved by TenantMiddleware from subdomain/
 * host/header — mirrored here for parity.
 */
export async function getTenant(userId: string) {
  const membership = await db.tenantMembership.findFirst({
    where: { userId, currentOrg: true, isActive: true },
    include: { organization: true, role: true },
  })
  if (!membership) return null
  return {
    organization: membership.organization,
    role: membership.role,
    membership,
  }
}

export async function switchTenant(userId: string, organizationId: string) {
  await db.tenantMembership.updateMany({
    where: { userId },
    data: { currentOrg: false },
  })
  await db.tenantMembership.update({
    where: { userId_organizationId: { userId, organizationId } },
    data: { currentOrg: true },
  })
}

/**
 * IP allowlist check per organization.
 */
export async function checkIpAllowlist(organizationId: string, ip: string): Promise<boolean> {
  const org = await db.organization.findUnique({ where: { id: organizationId } })
  if (!org) return false
  const list = JSON.parse(org.ipAllowlist || '[]') as string[]
  if (list.length === 0) return true // empty allowlist = allow all
  return list.some((cidr) => ipMatchesCidr(ip, cidr))
}

function ipMatchesCidr(ip: string, cidr: string): boolean {
  // Simple wildcard / exact match for the sandbox; real impl in Django uses ipaddress module.
  if (cidr === '*') return true
  if (cidr === ip) return true
  if (cidr.endsWith('/*')) return ip.startsWith(cidr.slice(0, -1))
  return false
}
