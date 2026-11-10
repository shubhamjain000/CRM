import { NextResponse } from 'next/server'
import { listNotes, createNote } from '@/lib/content/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listNotes({
      relatedModule: url.searchParams.get('relatedModule') ?? undefined,
      relatedId: url.searchParams.get('relatedId') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    })
    return NextResponse.json({ notes: items })
  } catch (e) {
    const status = e instanceof Error && (e.message === 'Unauthorized' || e.message === 'No organization') ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.title) return NextResponse.json({ error: 'Missing title' }, { status: 400 })
    const note = await createNote(body)
    return NextResponse.json({ id: note.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
