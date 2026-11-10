import { NextResponse } from 'next/server'
import { listWorkflows, createWorkflow } from '@/lib/workflow/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await listWorkflows()
    return NextResponse.json({ workflows: items })
  } catch (e) {
    const s = e instanceof Error && (e.message === 'Unauthorized' || e.message === 'No organization') ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: s })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.name || !body?.triggerType) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const w = await createWorkflow(body)
    return NextResponse.json({ id: w.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
