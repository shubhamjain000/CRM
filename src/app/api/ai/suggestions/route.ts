import { NextResponse } from 'next/server'
import { getSuggestions, generateSuggestions, dismissSuggestion } from '@/lib/ai/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try { return NextResponse.json({ suggestions: await getSuggestions() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (body?.action === 'generate') { const s = await generateSuggestions(); return NextResponse.json({ suggestions: s }) }
    if (body?.action === 'dismiss' && body.id) { await dismissSuggestion(body.id); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
