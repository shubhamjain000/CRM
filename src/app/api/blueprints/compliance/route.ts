import { NextResponse } from 'next/server'
import { getComplianceReport } from '@/lib/blueprint/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const pipelineId = url.searchParams.get('pipelineId') ?? undefined
    const report = await getComplianceReport(pipelineId)
    return NextResponse.json(report)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
