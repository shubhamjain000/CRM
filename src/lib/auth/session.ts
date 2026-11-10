import { db } from '@/lib/db'
import { cookies, headers } from 'next/headers'
import { createHash, randomBytes } from 'crypto'

const SESSION_COOKIE = 'fn_session'
const SESSION_TTL_DAYS = 30

export interface SessionUser {
  userId: string
  email: string
  name: string
  currentOrgId: string | null
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string; name?: string },
): Promise<string> {
  const token = generateSessionToken()
  const tokenHash = hashToken(token)
  await db.session.create({
    data: {
      userId,
      tokenHash,
      ip: meta.ip,
      userAgent: meta.userAgent,
      name: meta.name,
      expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  })
  return token
}

export async function getSession(): Promise<SessionUser | null> {
  // Primary: session cookie
  const cookieStore = await cookies()
  let token = cookieStore.get(SESSION_COOKIE)?.value

  // Fallback: Authorization: Bearer <token> — used when cookies are blocked
  // (e.g. embedded previews with third-party cookie restrictions)
  if (!token) {
    try {
      const h = await headers()
      const auth = h.get('authorization') ?? ''
      if (auth.toLowerCase().startsWith('bearer ')) {
        token = auth.slice(7).trim()
      }
    } catch {
      // headers() not available in this context
    }
  }

  if (!token) return null

  const tokenHash = hashToken(token)
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          memberships: { where: { currentOrg: true }, take: 1 },
        },
      },
    },
  })

  if (!session) return null
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } })
    return null
  }

  // Touch lastSeen
  await db.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  })

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    currentOrgId: session.user.memberships[0]?.organizationId ?? null,
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return
  const tokenHash = hashToken(token)
  await db.session.deleteMany({ where: { tokenHash } })
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies()
  // When served over HTTPS (e.g. through the preview gateway), mark the
  // cookie SameSite=None; Secure so it also works inside embedded previews
  // / iframes. Over plain HTTP (local dev) keep Lax — Secure cookies would
  // be rejected there.
  let isHttps = false
  try {
    const h = await headers()
    isHttps = (h.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https'
  } catch {
    isHttps = false
  }
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps || process.env.NODE_ENV === 'production',
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}

export function getRequestMeta(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  const userAgent = req.headers.get('user-agent') || 'unknown'
  return { ip, userAgent }
}
