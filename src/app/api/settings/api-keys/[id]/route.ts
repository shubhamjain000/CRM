import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { hasPermission } from '@/lib/auth/permissions'
import { audit } from '@/lib/auth/audit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Revoke an API key. Allowed for the key's owner or an organization admin —
 * revocation is permanent and cannot be undone.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await getTenant(session.userId)
  if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

  const { id } = await params
  const key = await db.apiKey.findFirst({
    where: { id, organizationId: tenant.organization.id },
  })
  if (!key) return NextResponse.json({ error: 'API key not found' }, { status: 404 })

  const isOwner = key.userId === session.userId
  const isAdmin = await hasPermission(tenant.role.id, 'org.admin')
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await db.apiKey.update({
    where: { id: key.id },
    data: { revokedAt: new Date() },
  })

  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: 'apikey.revoke',
    targetType: 'api_key',
    targetId: key.id,
    metadata: { name: key.name, prefix: key.keyPrefix },
  })

  return NextResponse.json({ ok: true })
}
