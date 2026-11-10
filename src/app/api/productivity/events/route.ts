import { NextResponse } from 'next/server'
import { listProd, createProd, detectConflicts } from '@/lib/productivity/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listProd('event', {
      filters: Object.fromEntries(url.searchParams.entries()) as Record<string, string>,
      sort: url.searchParams.get('sort') ?? 'start',
    })
    return NextResponse.json({ events: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    // Conflict detection
    if (body.start && body.end) {
      const conflicts = await detectConflicts(new Date(body.start), new Date(body.end))
      if (conflicts.length > 0) {
        return NextResponse.json({ error: 'Conflict detected', conflicts }, { status: 409 })
      }
    }
    const event = await createProd('event', body)
    return NextResponse.json({ id: event.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
