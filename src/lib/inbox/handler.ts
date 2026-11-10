import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { sendEmail } from '@/lib/email/handler'
import { sendSms } from '@/lib/telephony/handler'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

const CHANNEL_ICONS: Record<string, string> = {
  email: 'Mail', whatsapp: 'MessageCircle', telephony: 'Phone',
  livechat: 'Chat', social: 'Globe', sms: 'MessageSquare',
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function listConversations(opts: {
  channel?: string; status?: string; assignedToMe?: boolean; search?: string
} = {}) {
  const { session, tenant } = await ctx()
  return db.unifiedConversation.findMany({
    where: {
      organizationId: tenant.organization.id,
      isMerged: false,
      ...(opts.channel ? { channel: opts.channel } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.assignedToMe ? { assignedToId: session.userId } : {}),
      ...(opts.search ? {
        OR: [
          { participantName: { contains: opts.search } },
          { subject: { contains: opts.search } },
          { participantIdentifier: { contains: opts.search } },
        ],
      } : {}),
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  })
}

export async function getConversation(id: string) {
  const { tenant } = await ctx()
  return db.unifiedConversation.findFirst({
    where: { id, organizationId: tenant.organization.id },
    include: { messages: { orderBy: { timestamp: 'asc' }, take: 200 } },
  })
}

export async function createConversation(data: {
  channel: string; participantName: string; participantIdentifier: string
  subject?: string; externalId?: string; relatedModule?: string; relatedId?: string
}) {
  const { session, tenant } = await ctx()
  return db.unifiedConversation.create({
    data: {
      organizationId: tenant.organization.id,
      channel: data.channel,
      participantName: data.participantName,
      participantIdentifier: data.participantIdentifier,
      subject: data.subject,
      externalId: data.externalId,
      relatedModule: data.relatedModule,
      relatedId: data.relatedId,
      assignedToId: session.userId,
    },
  })
}

export async function sendReply(conversationId: string, body: string, channel?: string) {
  const { session, tenant } = await ctx()
  const conv = await db.unifiedConversation.findFirst({
    where: { id: conversationId, organizationId: tenant.organization.id },
  })
  if (!conv) throw new Error('Conversation not found')

  const useChannel = channel ?? conv.channel

  // Create unified message
  const message = await db.unifiedMessage.create({
    data: {
      organizationId: tenant.organization.id,
      conversationId,
      channel: useChannel,
      sender: 'agent',
      body,
    },
  })

  // Update conversation
  await db.unifiedConversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      messageCount: { increment: 1 },
      status: conv.status === 'pending' ? 'open' : conv.status,
    },
  })

  // Actually send via the appropriate channel
  try {
    if (useChannel === 'email') {
      await sendEmail({
        to: [conv.participantIdentifier],
        subject: conv.subject ?? 'Re: Conversation',
        bodyHtml: body,
        relatedModule: conv.relatedModule ?? undefined,
        relatedId: conv.relatedId ?? undefined,
      })
    } else if (useChannel === 'sms' || useChannel === 'whatsapp') {
      await sendSms({
        toNumber: conv.participantIdentifier,
        body,
        relatedModule: conv.relatedModule ?? undefined,
        relatedId: conv.relatedId ?? undefined,
      })
    }
  } catch (e) {
    // Channel send may fail in sandbox — message is still recorded
  }

  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'inbox.reply', targetType: 'conversation', targetId: conversationId,
    metadata: { channel: useChannel },
  })

  return message
}

export async function assignConversation(conversationId: string, userId: string) {
  const { session, tenant } = await ctx()
  await db.unifiedConversation.updateMany({
    where: { id: conversationId, organizationId: tenant.organization.id },
    data: { assignedToId: userId },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'inbox.assign', targetType: 'conversation', targetId: conversationId,
  })
}

export async function tagConversation(conversationId: string, tags: string[]) {
  const { tenant } = await ctx()
  await db.unifiedConversation.updateMany({
    where: { id: conversationId, organizationId: tenant.organization.id },
    data: { tags: JSON.stringify(tags) },
  })
}

export async function closeConversation(conversationId: string) {
  const { session, tenant } = await ctx()
  await db.unifiedConversation.updateMany({
    where: { id: conversationId, organizationId: tenant.organization.id },
    data: { status: 'closed' },
  })
}

export async function addInternalNote(conversationId: string, note: string) {
  const { session, tenant } = await ctx()
  const conv = await db.unifiedConversation.findFirst({
    where: { id: conversationId, organizationId: tenant.organization.id },
  })
  if (!conv) throw new Error('Not found')
  const notes = JSON.parse(conv.internalNotes || '[]') as { author: string; body: string; timestamp: string }[]
  notes.push({ author: session.userId, body: note, timestamp: new Date().toISOString() })
  await db.unifiedConversation.update({
    where: { id: conversationId },
    data: { internalNotes: JSON.stringify(notes) },
  })
}

export async function mergeConversations(sourceId: string, targetId: string) {
  const { tenant } = await ctx()
  // Both conversations must belong to this tenant (prevents cross-org corruption)
  const [source, target] = await Promise.all([
    db.unifiedConversation.findFirst({ where: { id: sourceId, organizationId: tenant.organization.id }, select: { id: true } }),
    db.unifiedConversation.findFirst({ where: { id: targetId, organizationId: tenant.organization.id }, select: { id: true } }),
  ])
  if (!source) throw new Error('Source conversation not found')
  if (!target) throw new Error('Target conversation not found')
  // Move all messages from source to target
  await db.unifiedMessage.updateMany({
    where: { conversationId: sourceId, organizationId: tenant.organization.id },
    data: { conversationId: targetId },
  })
  // Mark source as merged
  await db.unifiedConversation.updateMany({
    where: { id: sourceId, organizationId: tenant.organization.id },
    data: { isMerged: true, mergedIntoId: targetId, status: 'closed' },
  })
  // Update target message count
  const count = await db.unifiedMessage.count({ where: { conversationId: targetId } })
  await db.unifiedConversation.update({
    where: { id: targetId },
    data: { messageCount: count },
  })
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export async function getAnalytics() {
  const { tenant } = await ctx()
  const orgId = tenant.organization.id
  const [total, open, resolved, closed] = await Promise.all([
    db.unifiedConversation.count({ where: { organizationId: orgId, isMerged: false } }),
    db.unifiedConversation.count({ where: { organizationId: orgId, isMerged: false, status: 'open' } }),
    db.unifiedConversation.count({ where: { organizationId: orgId, isMerged: false, status: 'resolved' } }),
    db.unifiedConversation.count({ where: { organizationId: orgId, isMerged: false, status: 'closed' } }),
  ])

  // Channel distribution (parallel — avoids 6 sequential round trips)
  const channels = ['email', 'whatsapp', 'telephony', 'livechat', 'social', 'sms']
  const counts = await Promise.all(
    channels.map((ch) =>
      db.unifiedConversation.count({ where: { organizationId: orgId, isMerged: false, channel: ch } }),
    ),
  )
  const channelCounts: Record<string, number> = {}
  channels.forEach((ch, i) => { channelCounts[ch] = counts[i] })

  return { total, open, resolved, closed, channelDistribution: channelCounts }
}

// ---------------------------------------------------------------------------
// Seed: create sample conversations for the unified inbox
// ---------------------------------------------------------------------------

export async function seedInbox() {
  const { session, tenant } = await ctx()
  const orgId = tenant.organization.id

  const samples = [
    { channel: 'email', participantName: 'John Smith', participantIdentifier: 'john@acme.com', subject: 'Pricing inquiry for Enterprise plan', body: 'Hi, I was wondering about your Enterprise pricing. We have 500+ users.' },
    { channel: 'whatsapp', participantName: 'Sarah Lee', participantIdentifier: '+1234567890', subject: 'Order #12345 status', body: 'When will my order ship?' },
    { channel: 'livechat', participantName: 'Website Visitor', participantIdentifier: 'visitor-001', subject: 'Product question', body: 'Does your CRM support custom fields?' },
    { channel: 'social', participantName: '@techreviewer', participantIdentifier: 'twitter:@techreviewer', subject: 'Mention: @yourbrand Love the new features!', body: 'Just tried the new pipeline view — amazing work!' },
    { channel: 'sms', participantName: 'Mike Johnson', participantIdentifier: '+1987654321', subject: 'Appointment reminder', body: 'Reminder: Your demo is tomorrow at 2pm.' },
  ]

  for (const s of samples) {
    const conv = await db.unifiedConversation.create({
      data: {
        organizationId: orgId,
        channel: s.channel,
        participantName: s.participantName,
        participantIdentifier: s.participantIdentifier,
        subject: s.subject,
        assignedToId: session.userId,
        status: 'open',
      },
    })
    // Customer message
    await db.unifiedMessage.create({
      data: {
        organizationId: orgId,
        conversationId: conv.id,
        channel: s.channel,
        sender: 'customer',
        body: s.body,
      },
    })
    await db.unifiedConversation.update({
      where: { id: conv.id },
      data: { messageCount: 1, lastMessageAt: new Date() },
    })
  }

  return { created: samples.length }
}

// ---------------------------------------------------------------------------
// WhatsApp → Unified Inbox sync
// Pulls the whatsapp-connector mini-service message log (live + demo sessions)
// into UnifiedConversation/UnifiedMessage so the Unified Inbox shows the same
// chats as the Channels → WhatsApp panel. Idempotent: connector message ids
// are stored in UnifiedMessage.metadata and skipped on re-sync.
// ---------------------------------------------------------------------------

/** Shape returned by the whatsapp-connector mini-service GET /messages. */
interface WaConnectorMessage {
  id: string
  from: string
  to: string
  text: string
  timestamp: number
  direction: 'in' | 'out'
}

const WA_CONNECTOR_URL = process.env.WA_CONNECTOR_URL ?? 'http://127.0.0.1:3010'

export async function syncWhatsappInbox() {
  const { session, tenant } = await ctx()
  const orgId = tenant.organization.id

  // 1) Pull the connector log — short timeout so the inbox never hangs on it.
  let waMessages: WaConnectorMessage[] = []
  try {
    const res = await fetch(`${WA_CONNECTOR_URL}/messages?limit=200`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    })
    if (!res.ok) throw new Error(`connector responded ${res.status}`)
    const data = await res.json()
    if (Array.isArray(data?.messages)) waMessages = data.messages as WaConnectorMessage[]
  } catch {
    return { ok: false as const, imported: 0, skipped: 0, reason: 'WhatsApp connector unreachable' }
  }
  if (waMessages.length === 0) return { ok: true as const, imported: 0, skipped: 0 }

  // 2) Dedupe against everything already imported for this org.
  const existing = await db.unifiedMessage.findMany({
    where: { organizationId: orgId, channel: 'whatsapp' },
    select: { metadata: true },
    orderBy: { timestamp: 'desc' },
    take: 1000,
  })
  const seen = new Set<string>()
  for (const m of existing) {
    try {
      const meta = JSON.parse(m.metadata || '{}') as { waId?: string }
      if (meta.waId) seen.add(meta.waId)
    } catch { /* ignore malformed metadata */ }
  }

  // 3) Group new messages by peer phone; import chronologically
  //    (the connector returns newest-first).
  const chronological = [...waMessages].reverse().filter((m) => m && m.id && !seen.has(m.id))
  const peers = new Map<string, WaConnectorMessage[]>()
  for (const m of chronological) {
    const peer = String(m.direction === 'in' ? m.from : m.to ?? '').replace(/\D/g, '')
    if (!peer) continue
    if (!peers.has(peer)) peers.set(peer, [])
    peers.get(peer)!.push(m)
  }

  let imported = 0
  // For the batch notification: count NEW customer-sent rows and remember the
  // first conversation they landed in (its assignee is who should react).
  let inboundImported = 0
  let firstInboundConv: { id: string; assigneeId: string | null; participantName: string } | null = null
  for (const [peer, msgs] of peers) {
    const externalId = `wa:${peer}`
    let conv = await db.unifiedConversation.findFirst({
      where: { organizationId: orgId, channel: 'whatsapp', externalId },
    })
    if (!conv) {
      // Best-effort friendly name from the Contacts module (phones are a JSON array).
      let name = `+${peer}`
      try {
        const contact = await db.contact.findFirst({
          where: { organizationId: orgId, phones: { contains: peer.slice(-10) } },
          select: { firstName: true, lastName: true },
        })
        if (contact) name = `${contact.firstName} ${contact.lastName}`.trim() || name
      } catch { /* naming is best-effort */ }
      conv = await db.unifiedConversation.create({
        data: {
          organizationId: orgId,
          channel: 'whatsapp',
          externalId,
          participantName: name,
          participantIdentifier: `+${peer}`,
          subject: 'WhatsApp conversation',
          status: 'open',
          priority: 'normal',
        },
      })
    }
    let lastAt = conv.lastMessageAt
    for (const m of msgs) {
      const ts = new Date(Number(m.timestamp) || Date.now())
      const sender = m.direction === 'in' ? 'customer' : 'agent'
      await db.unifiedMessage.create({
        data: {
          organizationId: orgId,
          conversationId: conv.id,
          channel: 'whatsapp',
          sender,
          body: String(m.text ?? ''),
          timestamp: ts,
          metadata: JSON.stringify({ waId: m.id, source: 'whatsapp-connector' }),
        },
      })
      imported += 1
      if (sender === 'customer') {
        inboundImported += 1
        if (!firstInboundConv) {
          firstInboundConv = { id: conv.id, assigneeId: conv.assignedToId, participantName: conv.participantName }
        }
      }
      if (ts > lastAt) lastAt = ts
    }
    await db.unifiedConversation.update({
      where: { id: conv.id },
      data: {
        lastMessageAt: lastAt,
        messageCount: { increment: msgs.length },
        status: conv.status === 'closed' ? 'open' : conv.status,
      },
    })
  }

  // ONE notification per sync batch — only when the sync actually imported new
  // customer-sent rows. Syncs with no new rows never notify (imported is 0 and
  // inboundImported stays 0, so repeated syncs stay silent).
  if (inboundImported > 0) {
    try {
      // Recipient: the conversation's assigned agent when one exists; otherwise
      // the user who ran the sync (they are tending the inbox).
      const recipientId = firstInboundConv?.assigneeId ?? session.userId
      const { createNotification } = await import('@/lib/realtime/handler')
      await createNotification({
        actorId: session.userId,
        verb: 'message',
        targetModule: 'inbox',
        targetId: firstInboundConv?.id,
        targetName: firstInboundConv?.participantName ?? 'WhatsApp',
        recipientId,
        data: { message: `${inboundImported} new WhatsApp message${inboundImported === 1 ? '' : 's'}`, importedTotal: imported },
      })
    } catch { /* notification is best-effort */ }
  }

  if (imported > 0) {
    await audit({
      organizationId: orgId, actorId: session.userId,
      action: 'inbox.whatsapp.sync', targetType: 'conversation',
      metadata: { imported },
    }).catch(() => { /* audit is best-effort */ })
  }

  return { ok: true as const, imported, skipped: waMessages.length - imported }
}
