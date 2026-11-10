import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { logActivity } from '@/lib/crm/ux'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function listCalls(opts: { relatedModule?: string; relatedId?: string } = {}) {
  const { tenant } = await ctx()
  return db.telephonyCall.findMany({
    where: {
      organizationId: tenant.organization.id,
      ...(opts.relatedModule && opts.relatedId ? { relatedModule: opts.relatedModule, relatedId: opts.relatedId } : {}),
    },
    orderBy: { startedAt: 'desc' },
    take: 50,
  })
}

export async function logCall(data: {
  toNumber: string; fromNumber?: string; direction?: string; duration?: number
  outcome?: string; notes?: string; relatedModule?: string; relatedId?: string
}) {
  const { session, tenant } = await ctx()
  const call = await db.telephonyCall.create({
    data: {
      organizationId: tenant.organization.id,
      fromNumber: data.fromNumber ?? 'unknown',
      toNumber: data.toNumber,
      direction: data.direction ?? 'outbound',
      status: 'completed',
      duration: data.duration ?? 0,
      outcome: data.outcome ?? 'connected',
      notes: data.notes,
      relatedModule: data.relatedModule,
      relatedId: data.relatedId,
      ownerId: session.userId,
      voipProvider: 'internal',
      endedAt: new Date(),
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'call.log', targetType: 'call', targetId: call.id,
  })
  if (data.relatedModule && data.relatedId) {
    await logActivity({ module: data.relatedModule, recordId: data.relatedId, action: 'called', description: `Call to ${data.toNumber}` })
  }
  return call
}

export async function clickToCall(toNumber: string, relatedModule?: string, relatedId?: string) {
  const { session, tenant } = await ctx()
  // In production, this would call the VoIP provider API to connect agent + customer
  const call = await db.telephonyCall.create({
    data: {
      organizationId: tenant.organization.id,
      fromNumber: 'agent-phone',
      toNumber,
      direction: 'outbound',
      status: 'ringing',
      relatedModule, relatedId,
      ownerId: session.userId,
      voipProvider: 'twilio',
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'call.initiate', targetType: 'call', targetId: call.id,
  })
  return call
}

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

export async function listSmsTemplates() {
  const { tenant } = await ctx()
  return db.smsTemplate.findMany({
    where: { organizationId: tenant.organization.id, isApproved: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createSmsTemplate(data: { name: string; body: string; category?: string }) {
  const { session, tenant } = await ctx()
  // Extract variables from body ({{var_name}})
  const variables = [...data.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
  return db.smsTemplate.create({
    data: {
      organizationId: tenant.organization.id,
      name: data.name,
      body: data.body,
      variables: JSON.stringify(variables),
      category: data.category ?? 'transactional',
      isApproved: true, // auto-approve in dev
    },
  })
}

export async function deleteSmsTemplate(id: string) {
  const { tenant } = await ctx()
  await db.smsTemplate.deleteMany({ where: { id, organizationId: tenant.organization.id } })
}

export async function sendSms(data: {
  toNumber: string; body: string; templateId?: string
  relatedModule?: string; relatedId?: string
  variables?: Record<string, string>
}) {
  const { session, tenant } = await ctx()
  let body = data.body
  // Render template variables
  if (data.variables) {
    for (const [key, val] of Object.entries(data.variables)) {
      body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val)
    }
  }

  // Calculate segments (160 chars per segment for GSM-7, 70 for unicode)
  const isUnicode = /[^\u0000-\u00ff]/.test(body)
  const maxChars = isUnicode ? 70 : 160
  const segments = Math.ceil(body.length / maxChars)

  const message = await db.smsMessage.create({
    data: {
      organizationId: tenant.organization.id,
      fromNumber: 'foundation-sms',
      toNumber: data.toNumber,
      body,
      direction: 'outbound',
      status: 'sent', // stub — would call provider API
      templateId: data.templateId,
      relatedModule: data.relatedModule,
      relatedId: data.relatedId,
      segments,
      sentAt: new Date(),
    },
  })

  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'sms.send', targetType: 'sms', targetId: message.id,
    metadata: { to: data.toNumber, segments },
  })

  return message
}

export async function listSmsMessages() {
  const { tenant } = await ctx()
  return db.smsMessage.findMany({
    where: { organizationId: tenant.organization.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

export async function listPhoneNumbers() {
  const { tenant } = await ctx()
  return db.phoneNumber.findMany({
    where: { organizationId: tenant.organization.id, isActive: true },
    orderBy: { createdAt: 'desc' },
  })
}
