import { NextResponse } from 'next/server'
import { updatePipeline, deletePipeline, createStage, reorderStages } from '@/lib/pipeline/handler'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    await updatePipeline(id, body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deletePipeline(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const status = e instanceof Error && e.message.includes('Cannot delete') ? 422 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}

// Create a stage in this pipeline
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body?.name) return NextResponse.json({ error: 'Missing stage name' }, { status: 400 })
    if (body.stageIds) {
      // Reorder stages
      await reorderStages(id, body.stageIds)
      return NextResponse.json({ ok: true })
    }
    const stage = await createStage(id, body)
    return NextResponse.json({ id: stage.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
