import { NextResponse } from 'next/server'
import { getConversation, assignConversation, tagConversation, closeConversation, addInternalNote } from '@/lib/inbox/handler'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const conv = await getConversation(id)
    if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ conversation: conv })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    if (body.assignToId) await assignConversation(id, body.assignToId)
    if (body.tags) await tagConversation(id, body.tags)
    if (body.close) await closeConversation(id)
    if (body.internalNote) await addInternalNote(id, body.internalNote)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
