import { NextResponse } from 'next/server'
import { destroySession, clearSessionCookie, getSession } from '@/lib/auth/session'
import { audit } from '@/lib/auth/audit'
import { getTenant } from '@/lib/auth/tenant'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getSession()
  if (session) {
    const tenant = await getTenant(session.userId)
    await audit({
      organizationId: tenant?.organization.id ?? null,
      actorId: session.userId,
      action: 'user.logout',
      ip: req.headers.get('x-forwarded-for') || null,
      userAgent: req.headers.get('user-agent') || null,
    })
    await db.session.deleteMany({ where: { userId: session.userId } }).catch(() => {})
  }
  await destroySession()
  await clearSessionCookie()
  return NextResponse.json({ ok: true })
}
