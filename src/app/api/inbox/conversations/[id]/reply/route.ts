import { NextResponse } from 'next/server'
import { sendReply } from '@/lib/inbox/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body?.body) return NextResponse.json({ error: 'Missing body' }, { status: 400 })
    const msg = await sendReply(id, body.body, body.channel)
    return NextResponse.json({ id: msg.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
