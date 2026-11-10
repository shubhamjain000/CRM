import { NextResponse } from 'next/server'
import { updateCustomField, deleteCustomField, CustomFieldNotFoundError } from '@/lib/crm/custom-fields'

export const dynamic = 'force-dynamic'

function statusFor(e: unknown): number {
  if (e instanceof CustomFieldNotFoundError) return 404
  if (e instanceof Error) {
    if (e.message === 'Unauthorized') return 401
    if (e.message === 'No organization') return 403
  }
  return 500
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    const field = await updateCustomField(id, body)
    return NextResponse.json({
      field: {
        ...field,
        fieldOptions: JSON.parse(field.fieldOptions || '{}'),
        validationRules: JSON.parse(field.validationRules || '{}'),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: statusFor(e) })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteCustomField(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: statusFor(e) })
  }
}
