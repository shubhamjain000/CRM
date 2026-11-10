import { NextResponse } from 'next/server'
import { getMyDeals } from '@/lib/pipeline/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const deals = await getMyDeals()
    return NextResponse.json({ deals })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
