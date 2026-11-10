import { NextResponse } from 'next/server'
import { listCustomFields, createCustomField } from '@/lib/crm/custom-fields'
export const dynamic = 'force-dynamic'

function statusFor(e: unknown): number {
  if (e instanceof Error) {
    if (e.message === 'Unauthorized') return 401
    if (e.message === 'No organization') return 403
  }
  return 500
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const moduleName = url.searchParams.get('module') ?? undefined
    const fields = await listCustomFields(moduleName)
    return NextResponse.json({
      fields: fields.map((f) => ({
        ...f,
        fieldOptions: JSON.parse(f.fieldOptions || '{}'),
        validationRules: JSON.parse(f.validationRules || '{}'),
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: statusFor(e) })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    const field = await createCustomField(body)
    return NextResponse.json({ id: field.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: statusFor(e) })
  }
}
