import { NextResponse } from 'next/server'
import { toggleReaction } from '@/lib/realtime/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (body?.emoji) {
      const result = await toggleReaction(null, id, body.emoji)
      return NextResponse.json(result)
    }
    return NextResponse.json({ error: 'Missing emoji' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
