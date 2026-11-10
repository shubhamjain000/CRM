import { NextResponse } from 'next/server'
import { convertLead } from '@/lib/crm/convert'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const result = await convertLead(id)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' ? 401
      : msg === 'No organization' ? 403
      : msg.includes('not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
