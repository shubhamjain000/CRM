import { NextResponse } from 'next/server'
import { getExecutions } from '@/lib/blueprint/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const stuckOnly = url.searchParams.get('stuckOnly') === 'true'
    const executions = await getExecutions({ stuckOnly })
    return NextResponse.json({ executions })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
