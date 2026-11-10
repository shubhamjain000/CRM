import { NextResponse } from 'next/server'
import { listBlueprints, createBlueprint } from '@/lib/blueprint/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await listBlueprints()
    return NextResponse.json({ blueprints: items })
  } catch (e) {
    const s = e instanceof Error && (e.message === 'Unauthorized' || e.message === 'No organization') ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: s })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.name || !body?.pipelineId) return NextResponse.json({ error: 'Missing name or pipelineId' }, { status: 400 })
    const bp = await createBlueprint(body)
    return NextResponse.json({ id: bp.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
