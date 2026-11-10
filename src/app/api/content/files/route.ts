import { NextResponse } from 'next/server'
import { listFiles, getFile } from '@/lib/content/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listFiles({
      relatedModule: url.searchParams.get('relatedModule') ?? undefined,
      relatedId: url.searchParams.get('relatedId') ?? undefined,
      starred: url.searchParams.get('starred') === 'true',
    })
    return NextResponse.json({ files: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
