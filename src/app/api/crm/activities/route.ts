import { NextResponse } from 'next/server'
import { getTimeline } from '@/lib/crm/ux'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const moduleName = url.searchParams.get('module') ?? ''
    const recordId = url.searchParams.get('recordId') ?? ''
    if (!moduleName || !recordId) return NextResponse.json({ error: 'Missing module/recordId' }, { status: 400 })
    const groups = await getTimeline(moduleName, recordId)
    return NextResponse.json({ groups })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
