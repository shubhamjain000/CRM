import { NextResponse } from 'next/server'
import { getComplianceChecklist, updateComplianceItem } from '@/lib/finalize/handler'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ frameworks: await getComplianceChecklist() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
export async function PATCH(req: Request) {
  try { const body = await req.json().catch(() => null); if (!body?.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 }); await updateComplianceItem(body.id, body.status, body.evidence); return NextResponse.json({ ok: true }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
