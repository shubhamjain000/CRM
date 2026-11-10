import { NextResponse } from 'next/server'
import { createMagicLink } from '@/lib/auth/magic-link'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body?.email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })
  const email = String(body.email).toLowerCase().trim()

  const token = await createMagicLink(email)

  // In the sandbox there's no mail server, so we return the dev link directly.
  // In production this would be emailed via the Celery `send_magic_link` task.
  const devLink = `/api/auth/magic-link/verify?token=${token}`
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ ok: true, devLink })
}
