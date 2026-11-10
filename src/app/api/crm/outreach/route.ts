import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { logActivity } from '@/lib/crm/ux'
import { audit } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

const CHANNEL_ACTION: Record<string, string> = {
  whatsapp: 'whatsapp',
  email: 'emailed',
  call: 'called',
  sms: 'sms',
}

const ALLOWED_MODULES = new Set([
  'lead', 'contact', 'account', 'deal', 'vendor',
  'quote', 'salesOrder', 'purchaseOrder', 'campaign',
])

function displayName(record: Record<string, unknown>): string {
  const first = typeof record.firstName === 'string' ? record.firstName : ''
  const last = typeof record.lastName === 'string' ? record.lastName : ''
  const name = `${first} ${last}`.trim()
  return name || (typeof record.name === 'string' ? record.name : '')
}

/**
 * POST /api/crm/outreach — record an outreach touchpoint made OUTSIDE the app
 * (e.g. the user clicked "WhatsApp" and continued in WhatsApp, or emailed via
 * their mail client). Keeps the record timeline honest about every channel.
 * Body: { module, recordId, channel: 'whatsapp'|'email'|'call'|'sms', description? }
 */
export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

    const body = await req.json().catch(() => null)
    const moduleName = typeof body?.module === 'string' ? body.module : ''
    const recordId = typeof body?.recordId === 'string' ? body.recordId : ''
    const channel = typeof body?.channel === 'string' ? body.channel : ''
    const description = typeof body?.description === 'string' ? body.description.slice(0, 500) : ''

    if (!ALLOWED_MODULES.has(moduleName) || !recordId || !CHANNEL_ACTION[channel]) {
      return NextResponse.json({ error: 'Invalid outreach payload' }, { status: 400 })
    }

    const delegate = db[moduleName as keyof typeof db] as any
    // Full record fetch (models differ in name fields) — scoped to the tenant.
    const record = await delegate.findFirst({
      where: { id: recordId, organizationId: tenant.organization.id, deletedAt: null },
    })
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await logActivity({
      module: moduleName,
      recordId,
      recordName: displayName(record),
      action: CHANNEL_ACTION[channel],
      description: description || (channel === 'whatsapp' ? 'Opened WhatsApp chat' : 'Outreach logged'),
    })
    await audit({
      organizationId: tenant.organization.id,
      actorId: session.userId,
      action: 'outreach.log',
      targetType: moduleName,
      targetId: recordId,
      metadata: { channel },
    })
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
