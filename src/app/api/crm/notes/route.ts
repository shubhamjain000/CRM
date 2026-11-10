import { NextResponse } from 'next/server'
import { listNotes, createNote } from '@/lib/crm/ux'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const moduleName = url.searchParams.get('module') ?? ''
    const recordId = url.searchParams.get('recordId') ?? ''
    const kind = url.searchParams.get('kind') ?? undefined
    if (!moduleName || !recordId) return NextResponse.json({ error: 'Missing module/recordId' }, { status: 400 })
    const notes = await listNotes(moduleName, recordId, kind)
    return NextResponse.json({ notes })
  } catch (e) {
    const status = e instanceof Error && e.message === 'Unauthorized' ? 401
      : e instanceof Error && e.message === 'No organization' ? 403 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.module || !body?.recordId || !body?.body) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }
    if (typeof body.body !== 'string' || body.body.length > 20000) {
      return NextResponse.json({ error: 'Note body too long or invalid' }, { status: 400 })
    }
    const note = await createNote(body.module, body.recordId, body.body, body.kind)
    return NextResponse.json({ id: note.id, kind: note.kind }, { status: 201 })
  } catch (e) {
    const status = e instanceof Error && e.message === 'Unauthorized' ? 401
      : e instanceof Error && e.message === 'No organization' ? 403 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}
