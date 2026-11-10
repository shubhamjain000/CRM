import { NextResponse } from 'next/server'
import { markRead, toggleStar, snoozeEmail } from '@/lib/email/handler'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (body?.markRead) await markRead(id)
    if (body?.isStarred !== undefined) await toggleStar(id, body.isStarred)
    if (body?.snoozedUntil) await snoozeEmail(id, body.snoozedUntil)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
