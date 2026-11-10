import { NextResponse } from 'next/server'
import { getWorkflow, updateWorkflow, deleteWorkflow, duplicateWorkflow, activateWorkflow, addAction, deleteAction, testRun, getExecutionHistory, getMetrics } from '@/lib/workflow/handler'
export const dynamic = 'force-dynamic'

/** Only these columns may be written via PATCH — clients cannot set arbitrary fields. */
const PATCHABLE_KEYS = ['name', 'triggerType', 'triggerModel', 'triggerConditions', 'isActive'] as const

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const w = await getWorkflow(id)
    if (!w) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ workflow: w })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

    // Whitelist accepted keys so clients can't write arbitrary columns.
    const data: Record<string, unknown> = {}
    for (const key of PATCHABLE_KEYS) {
      if (body[key] === undefined) continue
      data[key] = body[key]
    }

    // triggerConditions: accept an object (JSON.stringify it) or a pre-encoded string.
    if (data.triggerConditions !== undefined) {
      let tc: unknown = data.triggerConditions
      if (tc !== null && typeof tc === 'object') tc = JSON.stringify(tc)
      if (typeof tc !== 'string') tc = '{}'
      data.triggerConditions = (tc as string).trim() ? tc : '{}'
    }
    if (data.triggerType !== undefined && (typeof data.triggerType !== 'string' || !data.triggerType.trim())) {
      delete data.triggerType
    }
    if (data.triggerModel !== undefined && data.triggerModel !== null && typeof data.triggerModel !== 'string') {
      delete data.triggerModel
    }
    if (data.isActive !== undefined) data.isActive = Boolean(data.isActive)
    if (data.name !== undefined) data.name = String(data.name).slice(0, 200)

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
    }

    await updateWorkflow(id, data)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteWorkflow(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    if (body.action === 'duplicate') {
      const copy = await duplicateWorkflow(id)
      return NextResponse.json({ id: copy.id })
    }
    if (body.action === 'activate') {
      await activateWorkflow(id, body.active ?? true)
      return NextResponse.json({ ok: true })
    }
    if (body.action === 'add_action') {
      const a = await addAction(id, body)
      return NextResponse.json({ id: a.id }, { status: 201 })
    }
    if (body.action === 'delete_action') {
      await deleteAction(body.actionId)
      return NextResponse.json({ ok: true })
    }
    if (body.action === 'test_run') {
      const exec = await testRun(id, body.targetModule ?? 'lead', body.targetId ?? 'test')
      return NextResponse.json({ executionId: exec.id })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
