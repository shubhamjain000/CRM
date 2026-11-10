import { NextResponse } from 'next/server'
import { getOnboardingProgress, completeOnboardingStep } from '@/lib/finalize/handler'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ steps: await getOnboardingProgress() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
export async function POST(req: Request) {
  try { const body = await req.json().catch(() => null); if (!body?.step) return NextResponse.json({ error: 'Missing step' }, { status: 400 }); await completeOnboardingStep(body.step); return NextResponse.json({ ok: true }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
