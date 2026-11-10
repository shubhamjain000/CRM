import { NextResponse } from 'next/server'
import { listScheduledJobs, createScheduledJob, toggleScheduledJob } from '@/lib/workflow/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await listScheduledJobs()
    return NextResponse.json({ jobs: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.name || !body?.cronExpression) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const j = await createScheduledJob(body)
    return NextResponse.json({ id: j.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
