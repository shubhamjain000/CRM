import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { db } from '@/lib/db'
import { syncGmailAccount } from '@/lib/email/google'
import { syncGmailImapAccount } from '@/lib/email/google-imap'

export const dynamic = 'force-dynamic'

/**
 * POST /api/email/google/sync
 *
 * Pulls the latest mail for the org's connected Gmail mailboxes through the
 * REAL Gmail APIs (OAuth accounts → Gmail REST API; app-password accounts →
 * IMAP). Results are honest per-account: synced count or the actual error.
 * Body: { accountId?: string } — one account or all active Gmail ones.
 */
export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) throw new Error('Unauthorized')
    const tenant = await getTenant(session.userId)
    if (!tenant) throw new Error('No organization')

    const body = await req.json().catch(() => ({}))
    const where = {
      organizationId: tenant.organization.id,
      provider: 'gmail',
      isActive: true,
      syncEnabled: true,
      ...(typeof body?.accountId === 'string' && body.accountId ? { id: body.accountId } : {}),
    }
    const accounts = await db.emailAccount.findMany({ where })

    if (accounts.length === 0) {
      return NextResponse.json({ results: [], message: 'No connected Gmail accounts to sync' })
    }

    const results: {
      accountId: string
      emailAddress: string
      authMode: string | null
      synced: number
      skipped: boolean
      error?: string
    }[] = []
    for (const acct of accounts) {
      const target = {
        id: acct.id,
        organizationId: acct.organizationId,
        emailAddress: acct.emailAddress,
        credentials: acct.credentials,
      }
      const isOauth = acct.authMode === 'oauth'
      const result = isOauth
        ? await syncGmailAccount(target, 25)
        : await syncGmailImapAccount(target, 25)
      results.push({
        accountId: acct.id,
        emailAddress: acct.emailAddress,
        authMode: acct.authMode,
        ...result,
      })
    }
    return NextResponse.json({ results })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
