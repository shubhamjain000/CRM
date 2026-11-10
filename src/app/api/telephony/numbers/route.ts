import { NextResponse } from 'next/server'
import { listPhoneNumbers, provisionPhoneNumber } from '@/lib/channels/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const numbers = await listPhoneNumbers()
    return NextResponse.json({ numbers })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.number || !body?.provider) {
      return NextResponse.json({ error: 'Number and provider are required' }, { status: 400 })
    }
    const pn = await provisionPhoneNumber(body)
    return NextResponse.json({ number: pn }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : msg.startsWith('That phone number') ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
