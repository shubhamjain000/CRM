import { NextResponse } from 'next/server'
import { approveRequest } from '@/lib/rule-engine/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    if (!body?.requestId) return NextResponse.json({ error: 'Missing requestId' }, { status: 400 })
    await approveRequest(body.requestId, body.comment)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
