import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { listTenant, createTenant, type CrmModule } from '@/lib/crm/handler'
import { upsertCustomValues } from '@/lib/crm/custom-fields'
import { filterWritableForCaller, assertWritablePayload, maskRecordForCaller } from '@/lib/auth/field-security'

/**
 * Notify the (explicitly chosen) owner about their new lead.
 * Deliberately NOT fired when an assignment rule picked the owner — that path
 * already sends its own 'assignment_rule' notification, so this only covers
 * owner ≠ actor to avoid double-pinging.
 */
async function notifyLeadOwner(leadId: string, actorId: string): Promise<void> {
  try {
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: { ownerId: true, firstName: true, lastName: true },
    })
    if (!lead?.ownerId || lead.ownerId === actorId) return
    const { createNotification } = await import('@/lib/realtime/handler')
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'a new lead'
    await createNotification({
      actorId,
      verb: 'lead',
      targetModule: 'lead',
      targetId: leadId,
      targetName: name,
      recipientId: lead.ownerId,
      data: { message: `New lead assigned: ${name}` },
    })
  } catch {
    // Notifications are best-effort — never fail the create.
  }
}

export function makeListRoute(model: CrmModule) {
  return async function GET(req: Request) {
    try {
      const url = new URL(req.url)
      const params = {
        search: url.searchParams.get('search') ?? undefined,
        sort: url.searchParams.get('sort') ?? undefined,
        limit: Number(url.searchParams.get('limit') ?? 50),
        cursor: url.searchParams.get('cursor') ?? undefined,
        filters: Object.fromEntries(url.searchParams.entries()),
      }
      delete (params.filters as Record<string, unknown>).search
      delete (params.filters as Record<string, unknown>).sort
      delete (params.filters as Record<string, unknown>).limit
      delete (params.filters as Record<string, unknown>).cursor
      const result = await listTenant(model, params)
      return NextResponse.json(result)
    } catch (e) {
      const status = e instanceof Error && e.message === 'Unauthorized' ? 401
        : e instanceof Error && e.message === 'No organization' ? 403
        : e instanceof Error && e.message === 'Invalid owner' ? 400 : 500
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
    }
  }
}

export function makeCreateRoute(model: CrmModule) {
  return async function POST(req: Request) {
    try {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
      }
      const { customFields, ...data } = body
      // Field-level security: strip fields the caller's role may not write.
      const { data: writable, blocked } = await filterWritableForCaller(model, data)
      assertWritablePayload(writable, blocked)
      const record = await createTenant(model, writable)
      if (
        customFields && typeof customFields === 'object' && !Array.isArray(customFields) &&
        Object.keys(customFields as Record<string, unknown>).length > 0
      ) {
        await upsertCustomValues(model, record.id, customFields as Record<string, unknown>)
      }
      if (model === 'lead') {
        const session = await getSession()
        if (session) await notifyLeadOwner(record.id, session.userId)
      }
      return NextResponse.json(await maskRecordForCaller(model, record as Record<string, unknown>), { status: 201 })
    } catch (e) {
      const status = e instanceof Error && e.message === 'Unauthorized' ? 401
        : e instanceof Error && e.message === 'No organization' ? 403
        : e instanceof Error && e.message === 'Invalid owner' ? 400 : 500
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
    }
  }
}
