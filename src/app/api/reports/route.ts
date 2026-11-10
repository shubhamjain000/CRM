import { NextResponse } from 'next/server'
import { listReports, createReport } from '@/lib/reports/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await listReports()
    return NextResponse.json({ reports: items })
  } catch (e) {
    const s = e instanceof Error && (e.message === 'Unauthorized' || e.message === 'No organization') ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: s })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
    const r = await createReport(body)
    return NextResponse.json({ id: r.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
