import { NextResponse } from 'next/server'
import { chat, getChatHistory, clearChat } from '@/lib/ai/handler'
export const dynamic = 'force-dynamic'

const statusFor = (e: unknown) => (e instanceof Error && e.message === 'Unauthorized' ? 401 : 500)

export async function GET() {
  try { return NextResponse.json({ messages: await getChatHistory() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: statusFor(e) }) }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.message) return NextResponse.json({ error: 'Missing message' }, { status: 400 })
    if (body.action === 'clear') { await clearChat(); return NextResponse.json({ ok: true }) }
    const result = await chat(body.message, typeof body.timezone === 'string' ? body.timezone : 'UTC')
    return NextResponse.json(result)
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: statusFor(e) }) }
}
