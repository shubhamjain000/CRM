import { NextResponse } from 'next/server'
import { executeFunction } from '@/lib/custom-functions/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const result = await executeFunction(id, body.inputData ?? {}, body.trigger ?? 'manual')
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
