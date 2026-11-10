import { NextResponse } from 'next/server'
import { listProcesses, createProcess, addStep } from '@/lib/rule-engine/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listProcesses(url.searchParams.get('targetModel') ?? undefined)
    return NextResponse.json({ processes: items })
  } catch (e) {
    const s = e instanceof Error && (e.message === 'Unauthorized' || e.message === 'No organization') ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: s })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
    const p = await createProcess(body)
    return NextResponse.json({ id: p.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
