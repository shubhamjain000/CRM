import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { generateTotpSecret } from '@/lib/auth/totp'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { secret, uri } = generateTotpSecret(session.email)
  // Stash secret in the response only — client must verify before we persist.
  return NextResponse.json({ secret, uri })
}
