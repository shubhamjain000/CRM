import { NextResponse } from 'next/server'
import { listWhatsAppTemplates } from '@/lib/channels/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const templates = await listWhatsAppTemplates()
    return NextResponse.json({ templates })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
