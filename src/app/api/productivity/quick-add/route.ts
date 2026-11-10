import { NextResponse } from 'next/server'
import { parseNaturalLanguageTask } from '@/lib/productivity/nl-parser'
import { createProd } from '@/lib/productivity/handler'
export const dynamic = 'force-dynamic'

/**
 * Quick-add: POST { input: "Call John tomorrow 3pm" }
 * Parses with LLM → creates task → returns it.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.input) return NextResponse.json({ error: 'Missing input' }, { status: 400 })
    const parsed = await parseNaturalLanguageTask(String(body.input))
    const task = await createProd('task', {
      title: parsed.title,
      description: parsed.description,
      dueDate: parsed.dueDate,
      priority: parsed.priority,
      tags: JSON.stringify(parsed.tags ?? []),
      status: 'not_started',
    })
    return NextResponse.json({ id: task.id, parsed }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
