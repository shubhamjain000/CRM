import { NextResponse } from 'next/server'
import { addStep } from '@/lib/rule-engine/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body?.stepType) return NextResponse.json({ error: 'Missing stepType' }, { status: 400 })
    const step = await addStep(id, body)
    return NextResponse.json({ id: step.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
