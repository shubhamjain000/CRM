import { NextResponse } from 'next/server'
import { updatePresence, listPresence } from '@/lib/realtime/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await listPresence()
    return NextResponse.json({ presence: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    await updatePresence(body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
