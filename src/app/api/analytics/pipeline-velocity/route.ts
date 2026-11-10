import { NextResponse } from 'next/server'
import { getPipelineVelocity } from '@/lib/reports/handler'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ velocity: await getPipelineVelocity() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
