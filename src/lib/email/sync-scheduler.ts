import { db } from '@/lib/db'
import { syncGmailAccount } from '@/lib/email/google'
import { syncGmailImapAccount } from '@/lib/email/google-imap'

/**
 * Auto-polling for connected Gmail mailboxes.
 *
 * `syncDueGmailAccounts` is a pure function — it starts NO timers/cron of its
 * own. The job runner (src/lib/jobs/runner.ts) is expected to call it on its
 * regular tick; every call sweeps all active Gmail accounts and syncs those
 * whose per-account `syncFrequency` (minutes) has elapsed since
 * `lastSyncedAt`. The sync functions themselves stamp `lastSyncedAt` /
 * `lastSyncError`, so this wrapper stays read-only about account state.
 */

export interface SyncDueResult {
  /** Due accounts that were actually attempted this tick. */
  checked: number
  /** Accounts that completed a sync without an error this tick. */
  synced: number
  /** Accounts whose sync reported an error (or threw) this tick. */
  errors: number
}

/**
 * Consecutive-failure backoff (in-memory, dev server is single-process).
 * A failing account is retried at syncFrequency × 2^failures, capped at 30min,
 * so a permanently broken account (e.g. a demo row with no stored app
 * password) cannot churn the runner + logs every tick. Any successful sync
 * resets the streak.
 */
const failureStreak = new Map<string, number>()
const MAX_BACKOFF_MS = 30 * 60_000

function effectiveIntervalMs(baseMinutes: number, acctId: string): number {
  const base = Math.max(1, baseMinutes ?? 2) * 60_000
  const streak = failureStreak.get(acctId) ?? 0
  if (streak <= 0) return base
  return Math.min(base * 2 ** streak, MAX_BACKOFF_MS)
}

/** Sweep every active connected Gmail mailbox whose sync interval has elapsed. */
export async function syncDueGmailAccounts(): Promise<SyncDueResult> {
  const result: SyncDueResult = { checked: 0, synced: 0, errors: 0 }
  try {
    const accounts = await db.emailAccount.findMany({
      where: { provider: 'gmail', isActive: true, syncEnabled: true },
      select: {
        id: true,
        organizationId: true,
        emailAddress: true,
        credentials: true,
        authMode: true,
        syncFrequency: true,
        lastSyncedAt: true,
      },
    })
    const now = Date.now()
    for (const acct of accounts) {
      const intervalMs = effectiveIntervalMs(acct.syncFrequency ?? 2, acct.id)
      const last = acct.lastSyncedAt?.getTime() ?? 0
      if (now - last < intervalMs) continue
      result.checked++
      try {
        // OAuth accounts sync via the Gmail REST API; app-password accounts
        // (and anything unlabelled) via IMAP — same split the manual sync
        // route uses. Both update lastSyncedAt/lastSyncError themselves and
        // catch their own network errors.
        const target = {
          id: acct.id,
          organizationId: acct.organizationId,
          emailAddress: acct.emailAddress,
          credentials: acct.credentials,
        }
        const r = acct.authMode === 'oauth'
          ? await syncGmailAccount(target, 25)
          : await syncGmailImapAccount(target, 25)
        if (r.error) {
          result.errors++
          failureStreak.set(acct.id, (failureStreak.get(acct.id) ?? 0) + 1)
          // Backoff: a failed sync must not be retried every runner tick (60s).
          // Stamp lastSyncedAt so the next attempt waits a full sync interval
          // (doubled per consecutive failure, capped at 30min).
          await db.emailAccount.update({
            where: { id: acct.id },
            data: { lastSyncedAt: new Date() },
          }).catch(() => {})
        } else {
          result.synced++
          failureStreak.delete(acct.id)
        }
      } catch {
        // Belt & braces — the sync functions swallow their own errors; this
        // guards the sweep itself so one account can never abort the rest.
        result.errors++
        failureStreak.set(acct.id, (failureStreak.get(acct.id) ?? 0) + 1)
        // Same backoff for thrown errors.
        await db.emailAccount.update({
          where: { id: acct.id },
          data: { lastSyncedAt: new Date() },
        }).catch(() => {})
      }
    }
  } catch (e) {
    // A scheduler tick must never crash the runner.
    console.warn('[email-sync] syncDueGmailAccounts failed:', e instanceof Error ? e.message : e)
  }
  return result
}
