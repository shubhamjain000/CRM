import { NextResponse } from 'next/server'
import { deleteProd, updateProd } from '@/lib/productivity/handler'
export const dynamic = 'force-dynamic'

/** Edit an auto-logged call (duration / outcome / notes). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    // Only these fields are user-editable on a call log.
    const payload: Record<string, unknown> = {}
    if (typeof body.duration === 'number' && body.duration >= 0 && body.duration < 24 * 3600) {
      payload.duration = Math.round(body.duration)
    }
    if (typeof body.outcome === 'string' && ['connected', 'voicemail', 'no_answer', 'busy'].includes(body.outcome)) {
      payload.outcome = body.outcome
    }
    if (typeof body.notes === 'string') payload.notes = body.notes.slice(0, 2000)
    if (typeof body.endedAt === 'string') payload.endedAt = body.endedAt
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    await updateProd('call', id, payload)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const status = e instanceof Error && e.message === 'Unauthorized' ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}

/**
 * Soft-delete a call log (moves to trash). Used to discard an auto-logged call
 * that was a mistake, or to clean up test entries. The record stays in the DB
 * with deletedAt set so it can be restored from the trash if needed.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    await deleteProd('call', id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const status = e instanceof Error && e.message === 'Unauthorized' ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}
