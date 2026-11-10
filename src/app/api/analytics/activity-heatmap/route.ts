import { NextResponse } from 'next/server'
import { getActivityHeatmap } from '@/lib/reports/handler'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json(await getActivityHeatmap()) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
