import { NextResponse } from 'next/server'
import { getExecutionHistory, getMetrics } from '@/lib/workflow/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const url = new URL(req.url)
    if (url.searchParams.get('metrics') === 'true') {
      const m = await getMetrics(id)
      return NextResponse.json(m)
    }
    const history = await getExecutionHistory(id)
    return NextResponse.json({ executions: history })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
