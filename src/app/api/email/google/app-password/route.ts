import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { db } from '@/lib/db'
import { audit } from '@/lib/auth/audit'
import { isGmailAddress, verifyGmailAppPassword, syncGmailImapAccount } from '@/lib/email/google-imap'
import { encryptJson } from '@/lib/email/crypto'

export const dynamic = 'force-dynamic'

/**
 * POST /api/email/google/app-password
 *
 * Quick-connect path: verify a Gmail address + App Password against Google's
 * real SMTP server, store the mailbox, and run the first IMAP sync
 * immediately. Credentials are verified BEFORE the account is created — a
 * wrong password never produces a "connected" mailbox.
 */
export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) throw new Error('Unauthorized')
    const tenant = await getTenant(session.userId)
    if (!tenant) throw new Error('No organization')

    const body = await req.json().catch(() => null)
    const emailAddress = typeof body?.emailAddress === 'string' ? body.emailAddress.trim() : ''
    const appPassword = typeof body?.appPassword === 'string' ? body.appPassword.replace(/\s+/g, '') : ''
    if (!emailAddress || !appPassword) {
      return NextResponse.json({ error: 'Gmail address and App Password are required' }, { status: 400 })
    }
    if (!isGmailAddress(emailAddress)) {
      return NextResponse.json({ error: 'Enter a Gmail address (…@gmail.com / …@googlemail.com) — this quick path is Gmail-specific' }, { status: 400 })
    }
    if (appPassword.length !== 16) {
      return NextResponse.json({ error: 'A Google App Password is exactly 16 characters — generate one at myaccount.google.com/apppasswords' }, { status: 400 })
    }

    // REAL verification against Google SMTP — throws with an honest message.
    await verifyGmailAppPassword(emailAddress, appPassword)

    // Stored encrypted at rest (AES-256-GCM, see src/lib/email/crypto.ts).
    const credentials = await encryptJson({ mode: 'app-password', appPassword })
    const existing = await db.emailAccount.findFirst({
      where: { organizationId: tenant.organization.id, emailAddress, provider: 'gmail' },
      select: { id: true },
    })
    const account = existing
      ? await db.emailAccount.update({
          where: { id: existing.id },
          data: { credentials, authMode: 'app-password', isActive: true, syncEnabled: true, lastSyncError: null, userId: session.userId },
        })
      : await db.emailAccount.create({
          data: {
            organizationId: tenant.organization.id,
            userId: session.userId,
            provider: 'gmail',
            emailAddress,
            credentials,
            authMode: 'app-password',
            syncEnabled: true,
            syncFrequency: 2,
            isActive: true,
          },
        })

    await audit({
      organizationId: tenant.organization.id, actorId: session.userId,
      action: 'email_account.connect', targetType: 'email_account', targetId: account.id,
      metadata: { provider: 'gmail', authMode: 'app-password', emailAddress },
    })

    // First sync right away so the user sees mail without waiting for the job.
    const sync = await syncGmailImapAccount({
      id: account.id,
      organizationId: tenant.organization.id,
      emailAddress,
      credentials,
    }, 25)

    const { credentials: _stripped, ...safe } = account
    return NextResponse.json({ account: safe, sync }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 400
    return NextResponse.json({ error: msg }, { status })
  }
}
