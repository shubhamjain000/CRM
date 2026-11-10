import { NextResponse } from 'next/server'
import { getBlueprint, publishBlueprint, createTransition, deleteTransition, updateState } from '@/lib/blueprint/handler'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const bp = await getBlueprint(id)
    if (!bp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ blueprint: bp })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

    if (body.action === 'create_transition') {
      const t = await createTransition({ ...body, blueprintId: id })
      return NextResponse.json({ id: t.id }, { status: 201 })
    }
    if (body.action === 'delete_transition') {
      await deleteTransition(body.transitionId)
      return NextResponse.json({ ok: true })
    }
    if (body.action === 'update_state') {
      await updateState(body.stateId, body.data)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
