import { NextResponse } from 'next/server'
import { listInvoices, createInvoice } from '@/lib/ecosystem/handler'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ invoices: await listInvoices() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
export async function POST(req: Request) {
  try { const body = await req.json().catch(() => null); if (!body?.customerName) return NextResponse.json({ error: 'Missing customerName' }, { status: 400 }); const i = await createInvoice(body); return NextResponse.json({ id: i.id, invoice: i }, { status: 201 }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
