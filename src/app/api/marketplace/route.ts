import { NextResponse } from 'next/server'
import { listExtensions, getInstalledExtensions } from '@/lib/ecosystem/handler'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { const [catalog, installed] = await Promise.all([listExtensions(), getInstalledExtensions()]); return NextResponse.json({ catalog, installed }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
