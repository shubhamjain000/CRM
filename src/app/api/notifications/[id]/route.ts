import { NextResponse } from 'next/server'
import { markNotificationRead } from '@/lib/realtime/handler'
export const dynamic = 'force-dynamic'

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await markNotificationRead(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
