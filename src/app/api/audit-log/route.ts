import { NextResponse } from 'next/server'
import { listAuditLog, getRecordAudit } from '@/lib/finalize/handler'
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    if (url.searchParams.get('targetType') && url.searchParams.get('targetId')) {
      return NextResponse.json({ entries: await getRecordAudit(url.searchParams.get('targetType')!, url.searchParams.get('targetId')!) })
    }
    return NextResponse.json({ entries: await listAuditLog({ action: url.searchParams.get('action') ?? undefined, limit: Number(url.searchParams.get('limit') ?? 100) }) })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
