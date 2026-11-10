import { NextResponse } from 'next/server'
import { transitionDeal } from '@/lib/pipeline/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body?.toStageId) return NextResponse.json({ error: 'Missing toStageId' }, { status: 400 })
    const result = await transitionDeal(id, body.toStageId, body.reason)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }
    return NextResponse.json({ ok: true, deal: result.deal })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
