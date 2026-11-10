import { NextResponse } from 'next/server'
import { listComments, createComment, toggleReaction } from '@/lib/realtime/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const postId = url.searchParams.get('postId') ?? ''
    if (!postId) return NextResponse.json({ error: 'Missing postId' }, { status: 400 })
    const items = await listComments(postId)
    return NextResponse.json({ comments: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.postId || !body?.body) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const comment = await createComment(body.postId, body.body)
    return NextResponse.json({ id: comment.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
