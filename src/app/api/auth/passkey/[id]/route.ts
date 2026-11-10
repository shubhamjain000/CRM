import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/auth/passkey/[id] — removes one of the signed-in user's own
 * passkeys. Ownership is enforced by matching BOTH the credential id and the
 * session userId, so one user can never delete another user's credential by
 * guessing ids. Deleting the last passkey is allowed: password login (and any
 * other factors) remain available, so there is no lockout path.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const credential = await db.webAuthnCredential.findFirst({
      where: { id, userId: session.userId },
    })
    if (!credential) return NextResponse.json({ error: 'Passkey not found' }, { status: 404 })

    await db.webAuthnCredential.delete({ where: { id: credential.id } })

    const tenant = await getTenant(session.userId)
    await audit({
      organizationId: tenant?.organization.id ?? null,
      actorId: session.userId,
      action: 'passkey.delete',
      targetType: 'user',
      targetId: session.userId,
      ip: req.headers.get('x-forwarded-for') || null,
      userAgent: req.headers.get('user-agent') || null,
      metadata: { name: credential.name, credentialId: credential.credentialId },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to delete passkey' },
      { status: 500 },
    )
  }
}
