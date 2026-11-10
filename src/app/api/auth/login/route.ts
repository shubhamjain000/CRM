import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/auth/password'
import { verifyTotp } from '@/lib/auth/totp'
import { createSession, setSessionCookie, getRequestMeta } from '@/lib/auth/session'
import { recordLoginAttempt, isThrottled, attemptsRemaining } from '@/lib/auth/throttle'
import { recordLoginHistory } from '@/lib/auth/audit'
import { getTenant } from '@/lib/auth/tenant'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: 'Missing email or password' }, { status: 400 })
  }
  const email = String(body.email).toLowerCase().trim()
  const password = String(body.password)
  const meta = getRequestMeta(req)

  if (await isThrottled(meta.ip, email)) {
    return NextResponse.json(
      { error: 'Too many failed attempts. Try again later.' },
      { status: 429 },
    )
  }

  const user = await db.user.findUnique({ where: { email } })
  if (!user || !user.passwordHash) {
    await recordLoginAttempt(meta.ip, email, false)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) {
    await recordLoginAttempt(meta.ip, email, false)
    const remaining = await attemptsRemaining(meta.ip, email)
    return NextResponse.json(
      { error: 'Invalid credentials', attemptsRemaining: remaining },
      { status: 401 },
    )
  }

  await recordLoginAttempt(meta.ip, email, true)

  // 2FA gate
  if (user.is2faEnabled && user.totpSecret) {
    const code = body.totp
    if (!code) {
      return NextResponse.json(
        { twoFactorRequired: true, userId: user.id },
        { status: 202 },
      )
    }
    if (!verifyTotp(user.totpSecret, String(code))) {
      await recordLoginAttempt(meta.ip, email, false)
      return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 401 })
    }
  }

  const token = await createSession(user.id, { ...meta, name: 'Web browser' })
  await setSessionCookie(token)

  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastLoginIp: meta.ip },
  })

  const tenant = await getTenant(user.id)
  await recordLoginHistory({
    userId: user.id,
    organizationId: tenant?.organization.id ?? null,
    ip: meta.ip,
    userAgent: meta.userAgent,
    success: true,
    method: user.is2faEnabled ? '2fa' : 'password',
  })

  return NextResponse.json({ ok: true, token })
}
