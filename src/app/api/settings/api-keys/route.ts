import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { hasPermission } from '@/lib/auth/permissions'
import { generateApiKey, ApiAuthError } from '@/lib/api-keys'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** Parse an ApiKey row's scopes JSON safely. */
function parseScopes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    // fall through
  }
  return []
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await getTenant(session.userId)
  if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

  const isAdmin = await hasPermission(tenant.role.id, 'org.admin')
  const keys = await db.apiKey.findMany({
    where: { organizationId: tenant.organization.id },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { name: true } } },
  })

  const visible = isAdmin ? keys : keys.filter((k) => k.userId === session.userId)

  return NextResponse.json({
    keys: visible.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scopes: parseScopes(k.scopes),
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
      ownerName: k.user?.name ?? '—',
      isOwn: k.userId === session.userId,
    })),
    isAdmin,
  })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await getTenant(session.userId)
  if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const payload = (body ?? {}) as { name?: unknown; scope?: unknown; expiresInDays?: unknown }

  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  if (name.length < 1 || name.length > 80) {
    return NextResponse.json({ error: 'Name is required (1–80 characters)' }, { status: 400 })
  }

  const scopes = payload.scope === 'write' ? ['read', 'write'] : ['read']

  // Optional expiry: only 30/60/90-day presets are offered.
  const expiresInDays = payload.expiresInDays
  const expiresAt =
    typeof expiresInDays === 'number' && [30, 60, 90].includes(expiresInDays)
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null

  try {
    const { record, key } = await generateApiKey({ session, name, scopes, expiresAt })
    return NextResponse.json(
      {
        id: record.id,
        key,
        name: record.name,
        keyPrefix: record.keyPrefix,
        scopes: record.scopes,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      },
      { status: 201 },
    )
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
  }
}
