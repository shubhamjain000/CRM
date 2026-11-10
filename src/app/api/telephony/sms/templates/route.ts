import { NextResponse } from 'next/server'
import { listSmsTemplates, createSmsTemplate } from '@/lib/telephony/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await listSmsTemplates()
    return NextResponse.json({ templates: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.name || !body?.body) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const t = await createSmsTemplate(body)
    return NextResponse.json({ id: t.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
