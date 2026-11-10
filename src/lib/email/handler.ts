import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { logActivity } from '@/lib/crm/ux'
import { sanitizeHtml } from '@/lib/utils'
import { smtpConfigured, sendViaSmtp } from '@/lib/email/transport'
import { sendGmailMessage } from '@/lib/email/google'
import { sendViaAccountSmtp } from '@/lib/email/google-imap'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

// ---------------------------------------------------------------------------
// Email messages
// ---------------------------------------------------------------------------

export async function listEmails(opts: { starred?: boolean; unread?: boolean; relatedModule?: string; relatedId?: string; address?: string; limit?: number } = {}) {
  const { session, tenant } = await ctx()
  const emails = await db.email.findMany({
    where: {
      organizationId: tenant.organization.id,
      ...(opts.starred ? { isStarred: true } : {}),
      // Unread = inbound messages nobody opened. (Previously this also
      // filtered status:'sent', which is contradictory for inbound mail.)
      ...(opts.unread ? { direction: 'inbound' as const, openedAt: null } : {}),
      ...(opts.relatedModule && opts.relatedId ? { relatedModule: opts.relatedModule, relatedId: opts.relatedId } : {}),
      // Additive: address filter — matches mail whose from address or JSON
      // to/cc lists contain the address (SQLite LIKE is case-insensitive for
      // ASCII). Used by the record-detail "Emails" tab.
      ...(opts.address ? {
        OR: [
          { fromAddress: { contains: opts.address } },
          { toAddresses: { contains: opts.address } },
          { cc: { contains: opts.address } },
        ],
      } : {}),
    },
    orderBy: { receivedAt: 'desc' },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  })
  // Sanitize untrusted inbound HTML before it reaches any dangerouslySetInnerHTML sink
  return emails.map((e) => ({ ...e, bodyHtml: sanitizeHtml(e.bodyHtml) }))
}

export async function sendEmail(data: {
  to: string[]; cc?: string[]; bcc?: string[]; subject: string; bodyHtml: string
  relatedModule?: string; relatedId?: string; scheduledAt?: string
  accountId?: string // send THROUGH a connected Gmail mailbox (OAuth or app-password)
}) {
  const { session, tenant } = await ctx()
  // Auto-link to record if from/to matches a contact/lead
  let relatedModule = data.relatedModule
  let relatedId = data.relatedId

  if (!relatedModule || !relatedId) {
    // Try to match by email address — 2 batched queries instead of 2 per recipient
    const orEmails = data.to.map((email) => ({ emails: { contains: email } }))
    const [contact, lead] = await Promise.all([
      db.contact.findFirst({ where: { organizationId: tenant.organization.id, OR: orEmails } }),
      db.lead.findFirst({ where: { organizationId: tenant.organization.id, OR: orEmails } }),
    ])
    if (contact) { relatedModule = 'contact'; relatedId = contact.id }
    else if (lead) { relatedModule = 'lead'; relatedId = lead.id }
  }

  // Thread by normalized subject
  const normalizedSubject = data.subject.replace(/^(Re:|Fwd:|Fw:)\s*/gi, '').trim()
  let thread = await db.emailThread.findFirst({
    where: { organizationId: tenant.organization.id, subject: normalizedSubject },
  })
  if (!thread) {
    thread = await db.emailThread.create({
      data: {
        organizationId: tenant.organization.id,
        subject: normalizedSubject,
        relatedModule, relatedId,
        lastActivityAt: new Date(),
      },
    })
  }

  const bodyText = data.bodyHtml.replace(/<[^>]+>/g, '')
  const scheduled = Boolean(data.scheduledAt)

  // REAL DELIVERY: when SMTP is configured, attempt the actual send BEFORE
  // persisting, so the DB status reflects reality. Without SMTP configured the
  // message is stored as 'queued' (NOT a fake 'sent') and the background job
  // runner will deliver it as soon as SMTP credentials appear.
  let delivery: 'sent' | 'queued' | 'failed' = 'queued'
  let messageId: string | null = null
  if (!scheduled) {
    // PREFERRED: send through a connected Gmail mailbox (the Google email
    // connector) — real Gmail API (OAuth) or real Gmail SMTP (app password).
    if (data.accountId) {
      const acct = await db.emailAccount.findFirst({
        where: {
          id: data.accountId,
          organizationId: tenant.organization.id,
          provider: 'gmail',
          isActive: true,
        },
      })
      if (!acct) throw new Error('The selected connected mailbox was not found or is disconnected')
      try {
        const target = {
          id: acct.id,
          organizationId: acct.organizationId,
          emailAddress: acct.emailAddress,
          credentials: acct.credentials,
        }
        const result = acct.authMode === 'oauth'
          ? await sendGmailMessage(target, {
              to: data.to, cc: data.cc, bcc: data.bcc,
              subject: data.subject, text: bodyText, html: data.bodyHtml,
            })
          : await sendViaAccountSmtp(target, {
              to: data.to, cc: data.cc, bcc: data.bcc,
              subject: data.subject, text: bodyText, html: data.bodyHtml,
            })
        messageId = result && typeof result === 'object' ? result.messageId : result
        delivery = 'sent'
      } catch (e) {
        throw new Error(
          `Gmail send failed: ${e instanceof Error ? e.message : 'unknown error'} — the message was not sent.`,
        )
      }
    } else if (smtpConfigured()) {
      try {
        messageId = await sendViaSmtp({
          to: data.to,
          cc: data.cc,
          bcc: data.bcc,
          subject: data.subject,
          html: data.bodyHtml,
          text: bodyText,
          replyTo: session.email ?? undefined,
        })
        delivery = 'sent'
      } catch (e) {
        delivery = 'failed'
        throw new Error(
          `SMTP send failed: ${e instanceof Error ? e.message : 'unknown error'} — the message was not sent.`,
        )
      }
    }
    // else: stays 'queued' — honest state, picked up by the job runner once
    // SMTP_HOST is configured.
  }

  const email = await db.email.create({
    data: {
      organizationId: tenant.organization.id,
      accountId: data.accountId ?? null,
      threadId: thread.id,
      fromAddress: data.accountId
        ? (await db.emailAccount.findUnique({ where: { id: data.accountId }, select: { emailAddress: true } }))?.emailAddress ?? session.email ?? 'unknown'
        : session.email ?? 'unknown@foundation.test',
      toAddresses: JSON.stringify(data.to),
      cc: JSON.stringify(data.cc ?? []),
      bcc: JSON.stringify(data.bcc ?? []),
      subject: data.subject,
      bodyHtml: data.bodyHtml,
      bodyText,
      direction: 'outbound',
      status: delivery === 'sent' ? 'sent' : 'queued',
      relatedModule, relatedId,
      messageId,
      sentAt: delivery === 'sent' ? new Date() : null,
      scheduledAt: scheduled ? new Date(data.scheduledAt as string) : null,
    },
  })

  // Update thread
  await db.emailThread.update({
    where: { id: thread.id },
    data: { lastActivityAt: new Date(), emailCount: { increment: 1 } },
  })

  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'email.send', targetType: 'email', targetId: email.id,
    metadata: { to: data.to, subject: data.subject, delivery },
  })

  if (relatedModule && relatedId) {
    await logActivity({ module: relatedModule, recordId: relatedId, action: 'emailed', description: data.subject })
    // Part 6.3: auto-stamp the contact's Last Reached-Out Time when a real
    // send goes out from the CRM — keeps reachout metrics honest. Best-effort.
    if (delivery === 'sent' && relatedModule === 'contact') {
      try {
        await db.contact.updateMany({
          where: { id: relatedId, organizationId: tenant.organization.id },
          data: { lastReachedOutAt: new Date() },
        })
      } catch { /* stamping is an enhancement — never fail the send */ }
    }
  }

  return { ...email, delivery }
}

export async function markRead(id: string) {
  const { tenant } = await ctx()
  await db.email.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { openedAt: new Date() },
  })
}

export async function toggleStar(id: string, starred: boolean) {
  const { tenant } = await ctx()
  await db.email.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { isStarred: starred },
  })
}

export async function snoozeEmail(id: string, until: string) {
  const { tenant } = await ctx()
  await db.email.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { snoozedUntil: new Date(until) },
  })
}

export async function getThread(threadId: string) {
  const { tenant } = await ctx()
  const emails = await db.email.findMany({
    where: { threadId, organizationId: tenant.organization.id },
    orderBy: { receivedAt: 'asc' },
    take: 100,
  })
  return emails.map((e) => ({ ...e, bodyHtml: sanitizeHtml(e.bodyHtml) }))
}
