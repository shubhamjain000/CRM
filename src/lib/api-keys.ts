import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import type { SessionUser } from '@/lib/auth/session'

/**
 * API key management + authentication for the public REST API (BI integration).
 *
 * Keys are generated as `sk_live_<32 random bytes, base64url>`. Only the
 * SHA-256 hash of the full key is stored — the plaintext is returned exactly
 * once at creation time and can never be recovered afterwards.
 */

const KEY_PREFIX_LENGTH = 12

export class ApiAuthError extends Error {
  status: number
  constructor(message: string, status = 401) {
    super(message)
    this.name = 'ApiAuthError'
    this.status = status
  }
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export interface GeneratedApiKey {
  record: {
    id: string
    name: string
    keyPrefix: string
    scopes: string[]
    expiresAt: Date | null
    createdAt: Date
  }
  /** Full plaintext key — shown ONCE to the creator, never stored. */
  key: string
}

export async function generateApiKey(input: {
  session: SessionUser
  name: string
  scopes: string[]
  expiresAt: Date | null
}): Promise<GeneratedApiKey> {
  const tenant = await getTenant(input.session.userId)
  if (!tenant) throw new ApiAuthError('No organization', 403)

  const key = `sk_live_${randomBytes(32).toString('base64url')}`
  const keyHash = hashApiKey(key)
  const keyPrefix = key.slice(0, KEY_PREFIX_LENGTH)

  const row = await db.apiKey.create({
    data: {
      userId: input.session.userId,
      organizationId: tenant.organization.id,
      name: input.name,
      keyHash,
      keyPrefix,
      scopes: JSON.stringify(input.scopes),
      expiresAt: input.expiresAt,
    },
  })

  await audit({
    organizationId: tenant.organization.id,
    actorId: input.session.userId,
    action: 'apikey.create',
    targetType: 'api_key',
    targetId: row.id,
    metadata: { name: input.name, scopes: input.scopes, prefix: keyPrefix },
  })

  return {
    record: {
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      scopes: input.scopes,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    },
    key,
  }
}

export interface ApiKeyAuth {
  apiKey: {
    id: string
    name: string
    keyPrefix: string
  }
  organizationId: string
  userId: string
  scopes: string[]
}

/**
 * Authenticate a request via `X-API-Key: <key>` or `Authorization: Bearer <key>`.
 * Throws ApiAuthError with the appropriate HTTP status on any failure.
 */
export async function authenticateApiKey(req: Request): Promise<ApiKeyAuth> {
  let presented = req.headers.get('x-api-key')?.trim()
  if (!presented) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth.toLowerCase().startsWith('bearer ')) presented = auth.slice(7).trim()
  }
  if (!presented) throw new ApiAuthError('Missing API key', 401)

  const keyHash = hashApiKey(presented)
  const row = await db.apiKey.findUnique({
    where: { keyHash },
    include: {
      user: { select: { id: true, name: true, email: true } },
      organization: { select: { id: true, name: true } },
    },
  })
  if (!row) throw new ApiAuthError('Invalid API key', 401)
  if (row.revokedAt) throw new ApiAuthError('API key has been revoked', 403)
  if (row.expiresAt && row.expiresAt < new Date()) throw new ApiAuthError('API key has expired', 403)
  if (!row.organizationId || !row.organization) throw new ApiAuthError('API key has no organization', 403)

  // Fire-and-forget last-used stamp — never block or fail the request on it.
  void db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {})

  let scopes: string[] = []
  try {
    const parsed = JSON.parse(row.scopes)
    if (Array.isArray(parsed)) scopes = parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    scopes = []
  }

  return {
    apiKey: { id: row.id, name: row.name, keyPrefix: row.keyPrefix },
    organizationId: row.organizationId,
    userId: row.userId,
    scopes,
  }
}

export function requireScope(auth: ApiKeyAuth, scope: string): void {
  if (!auth.scopes.includes(scope)) {
    throw new ApiAuthError(`API key missing '${scope}' scope`, 403)
  }
}
