import { NextResponse } from 'next/server'
import { getLeaderboard } from '@/lib/dashboard/handler'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ leaderboard: await getLeaderboard() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
