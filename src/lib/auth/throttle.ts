import { db } from '@/lib/db'

const MAX_ATTEMPTS = 5
const WINDOW_MIN = 60 // 1 hour

/**
 * Throttling is keyed on the (ip, email) PAIR — not on ip OR email separately.
 *
 * Why: every visitor of the published preview reaches the app through the same
 * gateway egress IP (e.g. 21.0.0.1). The old ip-OR-email lookup meant 5 failed
 * attempts by ANY user (typos, forgotten passwords…) locked out EVERY sign-in
 * from that IP for a full hour — correct credentials included — which looked
 * exactly like "login is broken". Counting failures per account-per-IP keeps
 * the brute-force protection while a shared NAT/gateway IP can no longer lock
 * out unrelated users.
 */
export async function recordLoginAttempt(ip: string, email: string, success: boolean) {
  await db.loginAttempt.create({ data: { ip, email, success } })
}

export async function isThrottled(ip: string, email: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MIN * 60 * 1000)
  const failed = await db.loginAttempt.count({
    where: {
      ip,
      email,
      success: false,
      createdAt: { gte: since },
    },
  })
  return failed >= MAX_ATTEMPTS
}

export async function attemptsRemaining(ip: string, email: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MIN * 60 * 1000)
  const failed = await db.loginAttempt.count({
    where: {
      ip,
      email,
      success: false,
      createdAt: { gte: since },
    },
  })
  return Math.max(0, MAX_ATTEMPTS - failed)
}
