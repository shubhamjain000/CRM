import { NextResponse } from 'next/server'
import { getSalesFunnel } from '@/lib/reports/handler'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json(await getSalesFunnel()) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
