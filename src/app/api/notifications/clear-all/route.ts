import { NextResponse } from 'next/server'
import { archiveAllNotifications } from '@/lib/realtime/handler'
export const dynamic = 'force-dynamic'

/** "Clear all" — archives every notification for the current user (rows kept). */
export async function POST() {
  try {
    const archived = await archiveAllNotifications()
    return NextResponse.json({ ok: true, archived, unreadCount: 0 })
  } catch (e) {
    const status = e instanceof Error && e.message === 'Unauthorized' ? 401
      : e instanceof Error && e.message === 'No organization' ? 403 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}
