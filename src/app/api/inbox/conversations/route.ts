import { NextResponse } from 'next/server'
import { listConversations, createConversation, seedInbox } from '@/lib/inbox/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listConversations({
      channel: url.searchParams.get('channel') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      assignedToMe: url.searchParams.get('mine') === 'true',
      search: url.searchParams.get('search') ?? undefined,
    })
    return NextResponse.json({ conversations: items })
  } catch (e) {
    const s = e instanceof Error && (e.message === 'Unauthorized' || e.message === 'No organization') ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: s })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (body?.action === 'seed') {
      const result = await seedInbox()
      return NextResponse.json(result, { status: 201 })
    }
    if (!body?.channel || !body?.participantName) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const c = await createConversation(body)
    return NextResponse.json({ id: c.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
