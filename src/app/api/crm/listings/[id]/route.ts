import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'

/**
 * Single listing (ContactListing) — GET returns the row with recruiter/company
 * context; PATCH lets the sales agent fill or correct the sections that were
 * left blank on import (Visibility, Hired Count, Hiring Status, Relevant
 * Applications, plus the descriptive fields). Empty string values clear a
 * section back to blank.
 */

export const dynamic = 'force-dynamic'

const EDITABLE_STRINGS = new Set(['title', 'url', 'subtype', 'visibility', 'hiringStatus'])
const EDITABLE_INTS = new Set(['totalApplications', 'relevantApplications', 'hiredCount'])
const EDITABLE_DATES = new Set(['dateApproved'])

/** Coerce one incoming PATCH value; returns undefined for invalid types. */
function coerceValue(key: string, raw: unknown): unknown | undefined {
  if (EDITABLE_STRINGS.has(key)) {
    if (raw === null || raw === undefined) return null
    if (typeof raw !== 'string') return undefined
    const s = raw.trim()
    return s === '' ? null : s.slice(0, 500)
  }
  if (EDITABLE_INTS.has(key)) {
    if (raw === null || raw === undefined || raw === '') return null
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
    if (!Number.isFinite(n)) return undefined
    return Math.trunc(n)
  }
  if (EDITABLE_DATES.has(key)) {
    if (raw === null || raw === undefined || raw === '') return null
    const d = new Date(String(raw))
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  return undefined
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    const listing = await db.contactListing.findFirst({
      where: { id, organizationId: tenant.organization.id },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, emails: true, deletedAt: true } },
        account: { select: { id: true, name: true } },
      },
    })
    if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { contact, account, organizationId: _org, ...rest } = listing
    return NextResponse.json({
      ...rest,
      contactName: [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || null,
      contactEmails: contact?.emails ?? '[]',
      accountName: account?.name ?? null,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const data: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(body)) {
      if (key === 'contactId' || key === 'organizationId') continue
      const v = coerceValue(key, raw)
      if (v === undefined) continue
      data[key] = v
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    // Tenant-scoped update — a listing from another org simply won't match.
    const updated = await db.contactListing.updateMany({
      where: { id, organizationId: tenant.organization.id },
      data,
    })
    if (updated.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    try {
      const { audit } = await import('@/lib/auth/audit')
      await audit({
        organizationId: tenant.organization.id,
        actorId: session.userId,
        action: 'listing.update',
        targetType: 'contactListing',
        targetId: id,
      })
    } catch {
      // Audit is best-effort — never fail the save.
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
