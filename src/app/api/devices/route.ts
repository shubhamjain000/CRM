import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessions = await db.session.findMany({
    where: { userId: session.userId },
    orderBy: { lastSeenAt: 'desc' },
    take: 50,
  })

  // Mark the most-recent session as current.
  return NextResponse.json({
    devices: sessions.map((s, i) => ({
      id: s.id,
      name: s.name ?? 'Session',
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      isCurrent: i === 0,
    })),
  })
}

export async function DELETE(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await db.session.deleteMany({ where: { id, userId: session.userId } })
  return NextResponse.json({ ok: true })
}
