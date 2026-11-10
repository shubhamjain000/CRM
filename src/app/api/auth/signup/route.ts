import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, checkPasswordPolicy, isPasswordBreached } from '@/lib/auth/password'
import { provisionOrganization, slugify } from '@/lib/auth/provisioning'
import { createSession, setSessionCookie, getRequestMeta } from '@/lib/auth/session'
import { audit, recordLoginHistory } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body?.email || !body?.password || !body?.name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const email = String(body.email).toLowerCase().trim()
  const name = String(body.name).trim()
  const password = String(body.password)
  const orgName = String(body.orgName || `${name}'s Workspace`)

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
  }

  const policy = checkPasswordPolicy(password)
  if (!policy.ok) {
    return NextResponse.json({ error: 'Password too weak', reasons: policy.reasons }, { status: 422 })
  }

  if (await isPasswordBreached(password)) {
    return NextResponse.json({ error: 'This password has appeared in a known data breach. Choose another.' }, { status: 422 })
  }

  const passwordHash = await hashPassword(password)
  const user = await db.user.create({
    data: {
      email,
      name,
      passwordHash,
      profile: { create: {} },
      passwordHistory: { create: { passwordHash } },
    },
  })

  const { org } = await provisionOrganization({
    name: orgName,
    slug: slugify(orgName),
    subdomain: slugify(orgName),
    ownerId: user.id,
  })

  const meta = getRequestMeta(req)
  const token = await createSession(user.id, { ...meta, name: 'Web browser' })
  await setSessionCookie(token)

  await recordLoginHistory({
    userId: user.id,
    organizationId: org.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    success: true,
    method: 'password',
    metadata: { action: 'signup' },
  })
  await audit({
    organizationId: org.id,
    actorId: user.id,
    action: 'user.signup',
    targetType: 'user',
    targetId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    metadata: { email },
  })

  return NextResponse.json({ ok: true, userId: user.id, token })
}
