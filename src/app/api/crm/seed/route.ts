import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { seedCrmData } from '@/lib/crm/seed'
export const dynamic = 'force-dynamic'

/**
 * Seed test CRM data for the current organization.
 * POST tops up to 60 accounts, 120 contacts (with CSM cadence + listing
 * intelligence), 250 leads, 60 deals (incl. won/lost), 120 activities, 30
 * invoices, 45 tasks, 60 notes, 35 calls and 20 calendar events
 * (+ default pipeline, inventory/campaigns demo).
 * Idempotent top-up: modules already at target are skipped.
 *
 * DELETE removes ONLY records the seeder created (isSeed:true across those
 * models, FK-safe order) — real data is never touched.
 */
export async function POST() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

    const result = await seedCrmData(tenant.organization.id, session.userId)

    // Count current totals for the response
    const [accounts, contacts, leads, deals] = await Promise.all([
      db.account.count({ where: { organizationId: tenant.organization.id, deletedAt: null } }),
      db.contact.count({ where: { organizationId: tenant.organization.id, deletedAt: null } }),
      db.lead.count({ where: { organizationId: tenant.organization.id, deletedAt: null } }),
      db.deal.count({ where: { organizationId: tenant.organization.id, deletedAt: null } }),
    ])

    return NextResponse.json({
      ok: true,
      created: result.created,
      totals: result.totals ?? { accounts, contacts, leads, deals },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

/** DELETE /api/crm/seed — delete ONLY isSeed-flagged records (per-model counts returned). */
export async function DELETE() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const organizationId = tenant.organization.id

    // FK-safe order: tasks/notes/calls/events (no cross-FKs with the CRM core)
    // → invoices (Payment→SetNull) → activities (no FKs) → deals →
    // contacts → leads (conversion refs cleared first) → accounts. A converted
    // seeded lead would otherwise block via Restrict on converted*/account FKs.
    const deleted = await db.$transaction(async (tx) => {
      const tasks = await tx.task.deleteMany({ where: { organizationId, isSeed: true } })
      const notes = await tx.note.deleteMany({ where: { organizationId, isSeed: true } })
      const calls = await tx.call.deleteMany({ where: { organizationId, isSeed: true } })
      const events = await tx.event.deleteMany({ where: { organizationId, isSeed: true } })
      const invoices = await tx.invoice.deleteMany({ where: { organizationId, isSeed: true } })
      const activities = await tx.activity.deleteMany({ where: { organizationId, isSeed: true } })
      const deals = await tx.deal.deleteMany({ where: { organizationId, isSeed: true } })
      const contacts = await tx.contact.deleteMany({ where: { organizationId, isSeed: true } })
      // Clear lead→record conversion links (onDelete: Restrict) before deleting.
      await tx.lead.updateMany({
        where: { organizationId, isSeed: true },
        data: { convertedAccountId: null, convertedContactId: null, convertedDealId: null },
      })
      const leads = await tx.lead.deleteMany({ where: { organizationId, isSeed: true } })
      const accounts = await tx.account.deleteMany({ where: { organizationId, isSeed: true } })
      return {
        tasks: tasks.count,
        notes: notes.count,
        calls: calls.count,
        events: events.count,
        invoices: invoices.count,
        activities: activities.count,
        deals: deals.count,
        contacts: contacts.count,
        leads: leads.count,
        accounts: accounts.count,
      }
    })

    const total = Object.values(deleted).reduce((sum, n) => sum + n, 0)
    return NextResponse.json({ ok: true, deleted, total })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
