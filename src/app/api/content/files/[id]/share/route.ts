import { NextResponse } from 'next/server'
import { createShareLink } from '@/lib/content/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const link = await createShareLink(id, {
      expiresHours: body.expiresHours ? Number(body.expiresHours) : undefined,
      password: body.password,
      downloadLimit: body.downloadLimit ? Number(body.downloadLimit) : undefined,
      watermark: body.watermark ?? true,
    })
    return NextResponse.json({ token: link.token, url: `/s/${link.token}` }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
