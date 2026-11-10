import { NextResponse } from 'next/server'
import { listProd, createProd } from '@/lib/productivity/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listProd('call', {
      filters: Object.fromEntries(url.searchParams.entries()) as Record<string, string>,
    })
    return NextResponse.json({ calls: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    const call = await createProd('call', body)
    return NextResponse.json({ id: call.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
