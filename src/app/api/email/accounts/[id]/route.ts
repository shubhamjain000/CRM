import { NextResponse } from 'next/server'
import { deleteEmailAccount } from '@/lib/channels/handler'
import { ensureEmailTokenKey } from '@/lib/email/crypto'
export const dynamic = 'force-dynamic'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    // Pre-warm the credential-encryption key: deleteEmailAccount decrypts the
    // stored OAuth credentials (sync path) to revoke the refresh token at
    // Google — the key must be cached before that synchronous parse runs.
    await ensureEmailTokenKey()
    await deleteEmailAccount(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : msg === 'Email account not found' ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
