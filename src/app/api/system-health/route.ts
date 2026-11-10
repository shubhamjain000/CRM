import { NextResponse } from 'next/server'
import { getSystemHealth } from '@/lib/finalize/handler'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json(await getSystemHealth()) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
