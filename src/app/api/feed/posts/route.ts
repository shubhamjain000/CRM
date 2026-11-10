import { NextResponse } from 'next/server'
import { listPosts, createPost } from '@/lib/realtime/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listPosts({
      relatedModule: url.searchParams.get('relatedModule') ?? undefined,
      relatedId: url.searchParams.get('relatedId') ?? undefined,
    })
    return NextResponse.json({ posts: items })
  } catch (e) {
    const s = e instanceof Error && (e.message === 'Unauthorized' || e.message === 'No organization') ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: s })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.body) return NextResponse.json({ error: 'Missing body' }, { status: 400 })
    const post = await createPost(body)
    return NextResponse.json({ id: post.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
