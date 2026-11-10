import { NextResponse } from 'next/server'
import { sendSms, listSmsMessages } from '@/lib/telephony/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await listSmsMessages()
    return NextResponse.json({ messages: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.toNumber || !body?.body) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const msg = await sendSms(body)
    return NextResponse.json({ id: msg.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
