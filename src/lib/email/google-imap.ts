import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { db } from '@/lib/db'
import { sanitizeHtml } from '@/lib/utils'
import type { SyncResult } from '@/lib/email/google'
import { applyInboundAssociations, extractEmailAddresses } from '@/lib/email/google'
import { decryptJson } from '@/lib/email/crypto'

/**
 * Gmail App Password quick-connect path.
 *
 * OAuth needs a Google Cloud project; many users just want to connect their
 * mailbox NOW. A Google **App Password** (myaccount.google.com/apppasswords,
 * requires 2-Step Verification) works with plain IMAP/SMTP:
 *
 *   - connect/verify: SMTP LOGIN against smtp.gmail.com:465
 *   - sync:           IMAP  against imap.gmail.com:993 (latest N messages)
 *   - send:           SMTP  with the same app password
 *
 * Verification happens BEFORE the account row is created — a wrong password
 * never produces a "connected" mailbox.
 */

const IMAP_HOST = 'imap.gmail.com'
const SMTP_HOST = 'smtp.gmail.com'

export function isGmailAddress(email: string): boolean {
  return /^[^@\s]+@(gmail\.com|googlemail\.com)$/i.test(email.trim())
}

/** Verify Gmail app-password credentials over SMTP. Throws on failure. */
export async function verifyGmailAppPassword(emailAddress: string, appPassword: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: 465,
    secure: true,
    auth: { user: emailAddress.trim(), pass: appPassword.trim() },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
  })
  try {
    await transporter.verify()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    if (/invalid login|auth|535|534|badcredentials/i.test(msg)) {
      throw new Error('Google rejected the email/app-password pair. Generate a fresh 16-character App Password (with 2-Step Verification enabled) and try again.')
    }
    throw new Error(`Could not reach Gmail SMTP: ${msg}`)
  } finally {
    transporter.close()
  }
}

/** Send through an app-password account. Throws on failure. */
export async function sendViaAccountSmtp(account: {
  emailAddress: string
  credentials: string
}, params: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html: string }): Promise<string> {
  // Encrypted `enc:v1:` credentials are decrypted here; legacy plaintext
  // passes through unchanged (crypto.ts).
  let appPassword = ''
  try {
    appPassword = ((await decryptJson(account.credentials || '{}')) as { appPassword?: string }).appPassword ?? ''
  } catch { /* handled below */ }
  if (!appPassword) throw new Error('Account has no stored app password')

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: 465,
    secure: true,
    auth: { user: account.emailAddress, pass: appPassword },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 25_000,
  })
  try {
    const info = await transporter.sendMail({
      from: account.emailAddress,
      to: params.to,
      cc: params.cc?.length ? params.cc : undefined,
      bcc: params.bcc?.length ? params.bcc : undefined,
      subject: params.subject,
      html: params.html || `<pre>${params.text}</pre>`,
      text: params.text,
    })
    return info.messageId || ''
  } finally {
    transporter.close()
  }
}

interface ParsedMailLike {
  messageId?: string
  inReplyTo?: string
  from?: { value?: { address?: string; name?: string }[] }
  to?: { value?: { address?: string }[] } | { value?: { address?: string }[] }[]
  cc?: { value?: { address?: string }[] } | { value?: { address?: string }[] }[]
  subject?: string
  date?: Date
  html?: string | false
  text?: string
  attachments?: { filename?: string; contentType?: string; size?: number }[]
}

function addrList(field: ParsedMailLike['to']): string[] {
  if (!field) return []
  const arr = Array.isArray(field) ? field : [field]
  return arr.flatMap((g) => (g.value ?? []).map((v) => v.address).filter((a): a is string => Boolean(a)))
}

/**
 * Sync the latest messages of an app-password account over IMAP.
 * Bounded: connects, fetches the newest `max`, upserts, disconnects.
 */
export async function syncGmailImapAccount(account: {
  id: string
  organizationId: string
  emailAddress: string
  credentials: string
}, max = 25): Promise<SyncResult> {
  // Encrypted `enc:v1:` credentials are decrypted here; legacy plaintext
  // passes through unchanged (crypto.ts).
  let appPassword = ''
  try {
    appPassword = ((await decryptJson(account.credentials || '{}')) as { appPassword?: string }).appPassword ?? ''
  } catch { /* handled below */ }
  if (!appPassword) {
    const err = 'Account has no stored app password'
    await db.emailAccount.update({ where: { id: account.id }, data: { lastSyncError: err } }).catch(() => {})
    return { synced: 0, skipped: false, error: err }
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: account.emailAddress, pass: appPassword },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    let synced = 0
    try {
      const mailboxInfo = client.mailbox
      const total = mailboxInfo && typeof mailboxInfo === 'object' && typeof mailboxInfo.exists === 'number' ? mailboxInfo.exists : 0
      if (total === 0) {
        await db.emailAccount.update({ where: { id: account.id }, data: { lastSyncedAt: new Date(), lastSyncError: null } }).catch(() => {})
        return { synced: 0, skipped: false }
      }
      const start = Math.max(1, total - max + 1)
      const range = `${start}:${total}`
      for await (const msg of client.fetch(range, { envelope: true, source: true, uid: true, internalDate: true })) {
        if (!msg.source) continue
        const parsed = await simpleParser(msg.source) as unknown as ParsedMailLike
        const gmailId = String(msg.uid)
        const existing = await db.email.findFirst({
          where: { organizationId: account.organizationId, accountId: account.id, messageId: gmailId },
          select: { id: true },
        })
        if (existing) continue
        const attachments = (parsed.attachments ?? []).map((a) => ({
          filename: a.filename ?? 'attachment',
          mimeType: a.contentType ?? 'application/octet-stream',
          size: a.size ?? 0,
        }))
        const toList = addrList(parsed.to)
        const created = await db.email.create({
          data: {
            organizationId: account.organizationId,
            accountId: account.id,
            messageId: gmailId,
            fromAddress: parsed.from?.value?.[0]?.address ?? parsed.from?.value?.[0]?.name ?? 'unknown',
            toAddresses: JSON.stringify(toList),
            cc: JSON.stringify(addrList(parsed.cc)),
            subject: parsed.subject || '(no subject)',
            bodyHtml: sanitizeHtml(typeof parsed.html === 'string' ? parsed.html : ''),
            bodyText: parsed.text ?? '',
            attachments: JSON.stringify(attachments),
            direction: 'inbound',
            status: 'delivered',
            hasAttachments: attachments.length > 0,
            labels: JSON.stringify([]),
            receivedAt: parsed.date ?? msg.internalDate ?? new Date(),
          },
        })
        // Additive: link to a matching contact / thread and detect replies.
        await applyInboundAssociations({
          organizationId: account.organizationId,
          emailId: created.id,
          fromAddress: parsed.from?.value?.[0]?.address ?? parsed.from?.value?.[0]?.name ?? 'unknown',
          toAddresses: toList.length > 0 ? toList : extractEmailAddresses(account.emailAddress),
          subject: parsed.subject || '',
          inReplyTo: parsed.inReplyTo || undefined,
        })
        synced++
      }
    } finally {
      lock.release()
    }
    await client.logout()
    await db.emailAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    }).catch(() => {})
    return { synced, skipped: false }
  } catch (e) {
    const raw = e instanceof Error ? e.message : 'Unknown IMAP error'
    const message = /auth|login|password|credentials/i.test(raw)
      ? 'Gmail IMAP rejected the credentials — regenerate the App Password and reconnect'
      : `IMAP sync failed: ${raw}`
    await db.emailAccount.update({
      where: { id: account.id },
      data: { lastSyncError: message.slice(0, 500) },
    }).catch(() => {})
    return { synced: 0, skipped: false, error: message }
  }
}
