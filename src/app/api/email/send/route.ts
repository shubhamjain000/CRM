import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.to || !body?.subject) return NextResponse.json({ error: 'Missing to or subject' }, { status: 400 })
    const email = await sendEmail(body)
    return NextResponse.json({ id: email.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
