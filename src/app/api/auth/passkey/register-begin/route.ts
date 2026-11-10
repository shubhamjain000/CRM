import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createRegistrationChallenge, webauthnContextFromRequest } from '@/lib/auth/passkey'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const options = await createRegistrationChallenge(
    session.userId,
    session.email,
    webauthnContextFromRequest(req, body?.origin),
  )
  return NextResponse.json(options)
}
