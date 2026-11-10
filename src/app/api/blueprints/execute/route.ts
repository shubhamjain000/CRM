import { NextResponse } from 'next/server'
import { executeTransition } from '@/lib/blueprint/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.dealId || !body?.toStateId) return NextResponse.json({ error: 'Missing dealId or toStateId' }, { status: 400 })
    const result = await executeTransition(body.dealId, body.toStateId, body.reason)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
