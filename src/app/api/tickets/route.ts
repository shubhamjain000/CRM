import { NextResponse } from 'next/server'
import { listTickets, createTicket } from '@/lib/ecosystem/handler'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ tickets: await listTickets() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
export async function POST(req: Request) {
  try { const body = await req.json().catch(() => null); if (!body?.subject) return NextResponse.json({ error: 'Missing subject' }, { status: 400 }); const t = await createTicket(body); return NextResponse.json({ id: t.id }, { status: 201 }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
