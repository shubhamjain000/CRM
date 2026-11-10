import { NextResponse } from 'next/server'
import { nlpQuery } from '@/lib/ai/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.question) return NextResponse.json({ error: 'Missing question' }, { status: 400 })
    const result = await nlpQuery(body.question, typeof body.timezone === 'string' ? body.timezone : 'UTC')
    return NextResponse.json(result)
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
