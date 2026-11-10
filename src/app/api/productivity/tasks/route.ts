import { NextResponse } from 'next/server'
import { listProd, createProd } from '@/lib/productivity/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listProd('task', {
      filters: Object.fromEntries(url.searchParams.entries()) as Record<string, string>,
      sort: url.searchParams.get('sort') ?? undefined,
    })
    return NextResponse.json({ tasks: items })
  } catch (e) {
    const status = e instanceof Error && (e.message === 'Unauthorized' || e.message === 'No organization') ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    const task = await createProd('task', body)
    return NextResponse.json({ id: task.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
