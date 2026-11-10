import { NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { getSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/**
 * Issue a short-lived HMAC-signed token the browser presents to the realtime
 * socket.io service on `join_room` so it can prove its identity and subscribe
 * to its own `user:<id>` room. Without this, the realtime service has no way
 * to know who a socket belongs to, and any browser could subscribe to any
 * user's notifications.
 *
 * Token format: `<userId>.<expMs>.<hexSig>` where hexSig = HMAC-SHA256(secret,
 * `${userId}:${expMs}`). Lifetime is 1 hour. The secret is shared with
 * `mini-services/realtime/index.ts` via `REALTIME_INTERNAL_KEY`.
 */
const SECRET = process.env.REALTIME_INTERNAL_KEY?.trim() || 'dev-insecure-realtime-key'
const TTL_MS = 60 * 60 * 1000

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const exp = Date.now() + TTL_MS
  const sig = createHmac('sha256', SECRET).update(`${session.userId}:${exp}`).digest('hex')
  const token = `${session.userId}.${exp}.${sig}`
  return NextResponse.json({ token, room: `user:${session.userId}`, expiresIn: TTL_MS })
}
