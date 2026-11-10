import { NextResponse } from 'next/server'
import { getDealVelocity } from '@/lib/pipeline/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const velocity = await getDealVelocity(id)
    return NextResponse.json({ velocity })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
