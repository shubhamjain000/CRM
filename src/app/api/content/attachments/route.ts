import { NextResponse } from 'next/server'
import { listAttachments, attachFile, detachFile } from '@/lib/content/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const recordModule = url.searchParams.get('recordModule') ?? ''
    const recordId = url.searchParams.get('recordId') ?? ''
    if (!recordModule || !recordId) return NextResponse.json({ error: 'Missing recordModule/recordId' }, { status: 400 })
    const items = await listAttachments(recordModule, recordId)
    return NextResponse.json({ attachments: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.recordModule || !body?.recordId || !body?.fileId) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }
    const att = await attachFile(body)
    return NextResponse.json({ id: att.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await detachFile(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
