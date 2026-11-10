import { NextResponse } from 'next/server'
import { deleteWhatsAppAccount } from '@/lib/channels/handler'
export const dynamic = 'force-dynamic'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteWhatsAppAccount(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : msg === 'WhatsApp account not found' ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
