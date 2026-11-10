import { NextResponse } from 'next/server'
import { listNotifications, getUnreadCount } from '@/lib/realtime/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listNotifications({
      unreadOnly: url.searchParams.get('unreadOnly') === 'true',
      archived: url.searchParams.get('archived') === 'true' ? true : undefined,
    })
    const count = await getUnreadCount()
    return NextResponse.json({ notifications: items, unreadCount: count })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
