import { NextResponse } from 'next/server'
import { listAnomalies, acknowledgeAnomaly, scanAnomalies } from '@/lib/ai/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try { return NextResponse.json({ anomalies: await listAnomalies() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (body?.action === 'scan') {
      // Run the rule-based scan first, then return the refreshed open list —
      // same response shape as GET so existing clients keep working.
      await scanAnomalies()
      return NextResponse.json({ anomalies: await listAnomalies() })
    }
    if (body?.action === 'acknowledge' && body.id) { await acknowledgeAnomaly(body.id); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
