import { NextResponse } from 'next/server'
import { createAuthenticationChallenge, webauthnContextFromRequest } from '@/lib/auth/passkey'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body?.email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })
  try {
    const options = await createAuthenticationChallenge(
      String(body.email).toLowerCase().trim(),
      webauthnContextFromRequest(req, body.origin),
    )
    return NextResponse.json(options)
  } catch {
    // Don't leak whether the email exists.
    return NextResponse.json({ error: 'Unable to start passkey login' }, { status: 400 })
  }
}
