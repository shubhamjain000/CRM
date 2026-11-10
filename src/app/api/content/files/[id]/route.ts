import { NextResponse } from 'next/server'
import { getFile, deleteFile, starFile, readFileData } from '@/lib/content/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const url = new URL(req.url)
    if (url.searchParams.get('download') === 'true') {
      const file = await getFile(id)
      if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const data = await readFileData(file.storageKey)
      return new NextResponse(new Uint8Array(data), {
        headers: {
          'Content-Type': file.mimeType,
          'Content-Disposition': `attachment; filename="${file.name}"`,
        },
      })
    }
    const file = await getFile(id)
    if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ file })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteFile(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (body?.isStarred !== undefined) {
      await starFile(id, body.isStarred)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
