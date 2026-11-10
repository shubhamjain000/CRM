import { NextResponse } from 'next/server'
import { scoreLead } from '@/lib/ai/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })
    const result = await scoreLead(body.leadId)
    return NextResponse.json(result)
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
