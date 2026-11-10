import { NextResponse } from 'next/server'
import { markAllRead } from '@/lib/realtime/handler'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await markAllRead()
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
