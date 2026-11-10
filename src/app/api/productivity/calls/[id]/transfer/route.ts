import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { isAdmin } from '@/lib/auth/permissions'
import { isValidOwner } from '@/lib/crm/assignment'
import { audit } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/productivity/calls/[id]/transfer
 *
 * Reassign a call log to another member of the organization. This is the
 * "transfer call" action and is restricted to admins (and owners, who carry
 * the `*` wildcard). The previous owner is preserved in `transferredFromId`
 * and the handoff is timestamped in `transferredAt` so the Calls history can
 * render a "Transferred to {name}" audit trail.
 *
 * Body: { transferredToId: string, notes?: string }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

    // Admin-only gate. Owners resolve to admin via the `*` wildcard.
    if (!(await isAdmin(tenant.role.id))) {
      return NextResponse.json({ error: 'Admins only — call transfer is restricted' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const transferredToId = typeof body?.transferredToId === 'string' ? body.transferredToId.trim() : ''
    if (!transferredToId) {
      return NextResponse.json({ error: 'A target member is required' }, { status: 400 })
    }
    const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 1000) : ''

    const organizationId = tenant.organization.id

    // The target must be an active member of the same org (closes the
    // cross-tenant write vector the same way lead/contact assignment does).
    if (!(await isValidOwner(organizationId, transferredToId))) {
      return NextResponse.json({ error: 'Invalid transfer target' }, { status: 400 })
    }

    // Load the call (tenant-scoped, not soft-deleted).
    const call = await db.call.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { id: true, ownerId: true, subject: true, notes: true },
    })
    if (!call) {
      return NextResponse.json({ error: 'Call not found' }, { status: 404 })
    }

    // Transferring to the current owner is a no-op — reject with a clear hint.
    if (call.ownerId === transferredToId) {
      return NextResponse.json(
        { error: 'That member already owns this call' },
        { status: 400 },
      )
    }

    const transferredAt = new Date()
    const transferredFromId = call.ownerId

    // Append a transfer note line to the call notes so the handoff is visible
    // inline as well as via the dedicated transfer fields.
    const noteLine = `[Transferred to ${transferredToId} by ${session.userId}]${notes ? ` ${notes}` : ''}`
    const mergedNotes = call.notes ? `${call.notes}\n${noteLine}` : noteLine

    const updated = await db.call.update({
      where: { id },
      data: {
        ownerId: transferredToId,
        transferredFromId,
        transferredToId,
        transferredAt,
        notes: mergedNotes,
      },
      select: {
        id: true,
        ownerId: true,
        transferredFromId: true,
        transferredToId: true,
        transferredAt: true,
      },
    })

    await audit({
      organizationId,
      actorId: session.userId,
      action: 'call.transfer',
      targetType: 'call',
      targetId: id,
      metadata: { transferredFromId, transferredToId, notes: notes || null },
    })

    return NextResponse.json({ ok: true, call: updated })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Server error' },
      { status: 500 },
    )
  }
}
