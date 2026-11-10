import { NextResponse } from 'next/server'
import { getPipelineMetrics } from '@/lib/pipeline/handler'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const metrics = await getPipelineMetrics(id)
    return NextResponse.json(metrics)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
