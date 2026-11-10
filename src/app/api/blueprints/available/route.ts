import { NextResponse } from 'next/server'
import { getAvailableTransitions } from '@/lib/blueprint/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const dealId = url.searchParams.get('dealId') ?? ''
    if (!dealId) return NextResponse.json({ error: 'Missing dealId' }, { status: 400 })
    const transitions = await getAvailableTransitions(dealId)
    return NextResponse.json({ transitions })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
