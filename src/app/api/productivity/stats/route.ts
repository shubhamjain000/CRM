import { NextResponse } from 'next/server'
import { getStats, getUpcomingEvents } from '@/lib/productivity/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [stats, events] = await Promise.all([getStats(), getUpcomingEvents()])
    return NextResponse.json({ stats, upcomingEvents: events })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
