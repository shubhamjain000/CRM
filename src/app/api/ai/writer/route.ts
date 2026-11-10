import { NextResponse } from 'next/server'
import { generateEmail } from '@/lib/ai/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.prompt) return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
    const result = await generateEmail(body.prompt, body.style, body.tone)
    return NextResponse.json(result)
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
