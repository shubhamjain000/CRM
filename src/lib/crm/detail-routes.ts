import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { updateTenant, softDeleteTenant, restoreTenant, bulkDeleteTenant, bulkUpdateTenant, type CrmModule } from '@/lib/crm/handler'
import { getCustomValuesMap, upsertCustomValues } from '@/lib/crm/custom-fields'
import { filterWritableForCaller, assertWritablePayload, maskRecordForCaller } from '@/lib/auth/field-security'

/**
 * Notify the deal's owner when someone else moved it to a new stage.
 * Best-effort: any failure here must never break the PATCH.
 */
async function notifyDealStageChanged(dealId: string, actorId: string, previous: { stageId: string; name: string; ownerId: string } | null): Promise<void> {
  try {
    if (!previous) return
    const deal = await db.deal.findUnique({
      where: { id: dealId },
      select: { ownerId: true, name: true, stageId: true },
    })
    if (!deal || deal.stageId === previous.stageId) return
    if (!deal.ownerId || deal.ownerId === actorId) return
    const stage = await db.stage.findUnique({ where: { id: deal.stageId }, select: { name: true } })
    const { createNotification } = await import('@/lib/realtime/handler')
    await createNotification({
      actorId,
      verb: 'deal',
      targetModule: 'deal',
      targetId: dealId,
      targetName: deal.name,
      recipientId: deal.ownerId,
      data: { message: `Deal ${deal.name} moved to ${stage?.name ?? 'a new stage'}` },
    })
  } catch {
    // Notifications are best-effort — never fail the update.
  }
}

function statusFor(e: unknown): number {
  if (e instanceof Error) {
    if (e.message === 'Unauthorized') return 401
    if (e.message === 'No organization') return 403
    if (e.message === 'Not found') return 404
    if (e.message === 'Invalid owner') return 400
    if (e.message.startsWith('Your role cannot edit these fields')) return 403
  }
  return 500
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  )
}

export function makeDetailRoutes(model: CrmModule) {
  async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const tenant = await getTenant(session.userId)
      if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
      const { id } = await params
      const delegate = db[model] as any
      const record = await delegate.findFirst({
        where: { id, organizationId: tenant.organization.id, deletedAt: null },
      })
      if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const customValues = await getCustomValuesMap(model, [id])
      // Field-level security: hide fields the caller's role cannot see.
      const masked = await maskRecordForCaller(model, record as Record<string, unknown>)
      // Contacts: attach the listing history (every listing imported for this
      // recruiter over time — the record's own listing* fields mirror the latest).
      let listings: unknown
      if (model === 'contact') {
        listings = await db.contactListing.findMany({
          where: { contactId: id },
          orderBy: [{ createdAt: 'desc' }],
          take: 100,
        })
      }
      return NextResponse.json({ ...masked, ...(listings ? { listings } : {}), customFields: customValues[id] ?? {} })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
    }
  }

  async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
      }
      const { customFields, ...data } = body
      // Field-level security: strip fields the caller's role may not write.
      const { data: writable, blocked } = await filterWritableForCaller(model, data)
      assertWritablePayload(writable, blocked)
      // Stage-change detection happens BEFORE the write so we can diff after.
      const stageSnapshot =
        model === 'deal' && typeof writable.stageId === 'string'
          ? await db.deal.findUnique({
              where: { id },
              select: { stageId: true, name: true, ownerId: true },
            })
          : null
      await updateTenant(model, id, writable)
      if (isNonEmptyObject(customFields)) {
        await upsertCustomValues(model, id, customFields)
      }
      if (stageSnapshot) {
        const session = await getSession()
        if (session) await notifyDealStageChanged(id, session.userId, stageSnapshot)
      }
      return NextResponse.json({ ok: true })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: statusFor(e) })
    }
  }

  async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params
      await softDeleteTenant(model, id)
      return NextResponse.json({ ok: true })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: statusFor(e) })
    }
  }

  return { GET, PATCH, DELETE }
}

/**
 * Bulk endpoints: /bulk-delete, /bulk-update, /restore
 */
export function makeBulkRoutes(model: CrmModule) {
  async function POST(req: Request) {
    try {
      const url = new URL(req.url)
      const action = url.pathname.split('/').pop()
      const body = await req.json().catch(() => null)
      if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

      if (action === 'bulk-delete') {
        const count = await bulkDeleteTenant(model, body.ids ?? [])
        return NextResponse.json({ ok: true, count })
      }
      if (action === 'bulk-update') {
        // Field-level security: strip non-writable fields from the bulk payload.
        const { data: writable, blocked } = await filterWritableForCaller(model, body.data ?? {})
        assertWritablePayload(writable, blocked)
        const count = await bulkUpdateTenant(model, body.ids ?? [], writable)
        return NextResponse.json({ ok: true, count })
      }
      if (action === 'restore') {
        await restoreTenant(model, body.id)
        return NextResponse.json({ ok: true })
      }
      return NextResponse.json({ error: 'Unknown bulk action' }, { status: 400 })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: statusFor(e) })
    }
  }
  return POST
}
