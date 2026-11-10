import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
export const dynamic = 'force-dynamic'

/**
 * Caller matching for inbound call logging.
 *
 * Given a query (phone digits or a name fragment) find the person in the CRM
 * the call likely came from — searched across Contacts and Leads of the
 * current organization. SQLite has no case-insensitive `contains`, so we pull
 * a bounded candidate page and filter in JS (orgs are small teams; 200 rows
 * covers every seeded/live org comfortably).
 */

interface Match {
  module: 'contact' | 'lead'
  id: string
  name: string
  phone: string
  extra: string | null
}

function firstPhone(phonesJson: string): string {
  try {
    const parsed = JSON.parse(phonesJson || '[]')
    if (Array.isArray(parsed)) {
      const hit = parsed.find((p) => typeof p === 'string' && p.trim())
      return hit ? (hit as string).trim() : ''
    }
  } catch { /* malformed JSON — ignore */ }
  return ''
}

/** Normalize to digits for phone matching ("+1-555-8061" → "15558061"). */
function digits(s: string): string {
  return s.replace(/\D/g, '')
}

export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const organizationId = tenant.organization.id

    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').trim()
    if (q.length < 2) return NextResponse.json({ matches: [] })

    const qLower = q.toLowerCase()
    const qDigits = digits(q)
    const byPhone = qDigits.length >= 3
    const byName = qLower.length >= 2

    const [contacts, leads] = await Promise.all([
      db.contact.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, phones: true, title: true },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      db.lead.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, phones: true, company: true },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
    ])

    const matches: Match[] = []
    for (const c of contacts) {
      const name = `${c.firstName} ${c.lastName}`.trim()
      const phone = firstPhone(c.phones)
      const nameHit = byName && (name.toLowerCase().includes(qLower) ||
        (c.title ?? '').toLowerCase().includes(qLower))
      const phoneHit = byPhone && phone && digits(phone).includes(qDigits)
      if (nameHit || phoneHit) {
        matches.push({ module: 'contact', id: c.id, name, phone, extra: c.title })
      }
    }
    for (const l of leads) {
      const name = `${l.firstName} ${l.lastName}`.trim()
      const phone = firstPhone(l.phones)
      const nameHit = byName && (name.toLowerCase().includes(qLower) ||
        (l.company ?? '').toLowerCase().includes(qLower))
      const phoneHit = byPhone && phone && digits(phone).includes(qDigits)
      if (nameHit || phoneHit) {
        matches.push({ module: 'lead', id: l.id, name, phone, extra: l.company })
      }
    }

    // Phone matches are the strongest signal — put them first.
    matches.sort((a, b) => {
      const ap = byPhone && a.phone && digits(a.phone).includes(qDigits) ? 0 : 1
      const bp = byPhone && b.phone && digits(b.phone).includes(qDigits) ? 0 : 1
      return ap - bp
    })

    return NextResponse.json({ matches: matches.slice(0, 6) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
