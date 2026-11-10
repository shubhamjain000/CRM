import { NextResponse } from 'next/server'
import { listRecentlyViewed, trackView } from '@/lib/crm/ux'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const moduleName = url.searchParams.get('module') ?? undefined
    const items = await listRecentlyViewed(moduleName, 10)
    return NextResponse.json({ items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.module || !body?.recordId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    await trackView(body.module, body.recordId, body.recordName ?? '')
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
