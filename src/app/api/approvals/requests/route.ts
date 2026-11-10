import { NextResponse } from 'next/server'
import { submitRequest, getPendingApprovals, getMyRequests } from '@/lib/rule-engine/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const filter = url.searchParams.get('filter')
    if (filter === 'pending') {
      const items = await getPendingApprovals()
      return NextResponse.json({ requests: items })
    }
    if (filter === 'my') {
      const items = await getMyRequests()
      return NextResponse.json({ requests: items })
    }
    const items = await getPendingApprovals()
    return NextResponse.json({ requests: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.processId || !body?.targetModule || !body?.targetId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const r = await submitRequest(body)
    return NextResponse.json({ id: r.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
