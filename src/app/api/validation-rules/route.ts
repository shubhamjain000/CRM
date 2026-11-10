import { NextResponse } from 'next/server'
import { listValidationRules, createValidationRule, deleteValidationRule, evaluateRule } from '@/lib/rule-engine/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listValidationRules(url.searchParams.get('targetModel') ?? undefined)
    return NextResponse.json({ rules: items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.fieldName) return NextResponse.json({ error: 'Missing fieldName' }, { status: 400 })
    const r = await createValidationRule(body)
    return NextResponse.json({ id: r.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
