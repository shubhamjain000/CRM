import { NextResponse } from 'next/server'
import { verifyMagicLink } from '@/lib/auth/magic-link'
import { createSession, setSessionCookie, getRequestMeta } from '@/lib/auth/session'
import { recordLoginHistory } from '@/lib/auth/audit'
import { getTenant } from '@/lib/auth/tenant'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const userId = await verifyMagicLink(token)
  if (!userId) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })

  const meta = getRequestMeta(req)
  const sessionToken = await createSession(userId, { ...meta, name: 'Magic link session' })
  await setSessionCookie(sessionToken)

  const tenant = await getTenant(userId)
  await recordLoginHistory({
    userId,
    organizationId: tenant?.organization.id ?? null,
    ip: meta.ip,
    userAgent: meta.userAgent,
    success: true,
    method: 'magic-link',
  })

  // Redirect to the app (sandbox single-route → `/`)
  return NextResponse.redirect(new URL('/', req.url))
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const token = body?.token ?? new URL(req.url).searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const userId = await verifyMagicLink(token)
  if (!userId) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })

  const meta = getRequestMeta(req)
  const sessionToken = await createSession(userId, { ...meta, name: 'Magic link session' })
  await setSessionCookie(sessionToken)

  const tenant = await getTenant(userId)
  await recordLoginHistory({
    userId,
    organizationId: tenant?.organization.id ?? null,
    ip: meta.ip,
    userAgent: meta.userAgent,
    success: true,
    method: 'magic-link',
  })

  return NextResponse.json({ ok: true, token: sessionToken })
}
