import { NextResponse } from 'next/server'
import { getForecast } from '@/lib/dashboard/handler'
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  try { const url = new URL(req.url); return NextResponse.json(await getForecast(url.searchParams.get('period') ?? 'monthly')) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
