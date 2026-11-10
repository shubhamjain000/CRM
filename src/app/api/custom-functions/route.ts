import { NextResponse } from 'next/server'
import { listFunctions, createFunction } from '@/lib/custom-functions/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await listFunctions()
    return NextResponse.json({ functions: items })
  } catch (e) {
    const s = e instanceof Error && (e.message === 'Unauthorized' || e.message === 'No organization') ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: s })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
    const fn = await createFunction(body)
    return NextResponse.json({ id: fn.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
