import { NextResponse } from 'next/server'
import { listPdfTemplates, createPdfTemplate } from '@/lib/customization/handler'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ templates: await listPdfTemplates() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
export async function POST(req: Request) {
  try { const body = await req.json().catch(() => null); if (!body?.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 }); const t = await createPdfTemplate(body); return NextResponse.json({ id: t.id }, { status: 201 }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
