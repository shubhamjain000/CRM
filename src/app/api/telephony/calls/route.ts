import { NextResponse } from 'next/server'
import { listCalls, logCall, clickToCall } from '@/lib/telephony/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listCalls({
      relatedModule: url.searchParams.get('relatedModule') ?? undefined,
      relatedId: url.searchParams.get('relatedId') ?? undefined,
    })
    return NextResponse.json({ calls: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    if (body.action === 'click_to_call') {
      const call = await clickToCall(body.toNumber, body.relatedModule, body.relatedId)
      return NextResponse.json({ id: call.id }, { status: 201 })
    }
    if (!body.toNumber) return NextResponse.json({ error: 'Missing toNumber' }, { status: 400 })
    const call = await logCall(body)
    return NextResponse.json({ id: call.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
