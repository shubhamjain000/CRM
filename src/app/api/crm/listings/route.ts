import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { Prisma } from '@prisma/client'

/**
 * Listings board — every ContactListing row (one row per listing a recruiter
 * accumulates over time) flattened into the table the sales team works from:
 * Listing Title · Date Approved · Applications · Listing URL · Listing Type ·
 * Visibility · Hired Count · Hiring Status · Created Time · Relevant
 * Applications (34% match & above), plus the recruiter/company context.
 */

export const dynamic = 'force-dynamic'

const PAGE_LIMIT_MAX = 200

/** Whitelisted sort fields (client sends `field` or `-field`). */
const SORT_FIELDS = new Set([
  'title', 'dateApproved', 'totalApplications', 'subtype', 'visibility',
  'hiredCount', 'hiringStatus', 'relevantApplications', 'createdAt',
  'lastImportedAt', 'premiumStatus', 'recruiterTag',
])

const LISTING_SELECT = {
  id: true,
  organizationId: true,
  contactId: true,
  accountId: true,
  url: true,
  title: true,
  subtype: true,
  category: true,
  recruiterTag: true,
  premiumStatus: true,
  visibility: true,
  hiringStatus: true,
  totalApplications: true,
  relevantApplications: true,
  hiredCount: true,
  reasonableFitPct: true,
  reasonableScoreUsers: true,
  dateApproved: true,
  source: true,
  firstImportedAt: true,
  lastImportedAt: true,
  createdAt: true,
  updatedAt: true,
  contact: {
    select: { id: true, firstName: true, lastName: true, emails: true, deletedAt: true },
  },
  account: { select: { id: true, name: true } },
} satisfies Prisma.ContactListingSelect

type ListingRow = Prisma.ContactListingGetPayload<{ select: typeof LISTING_SELECT }>

function serialize(l: ListingRow) {
  const { contact, account, organizationId: _org, ...rest } = l
  return {
    ...rest,
    contactName: [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || null,
    contactEmails: contact?.emails ?? '[]',
    contactDeleted: contact?.deletedAt != null,
    accountName: account?.name ?? null,
  }
}

export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const url = new URL(req.url)
    const search = url.searchParams.get('search')?.trim() ?? ''
    const sortParam = url.searchParams.get('sort') ?? ''
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), PAGE_LIMIT_MAX)
    const cursor = url.searchParams.get('cursor') ?? undefined

    const where: Record<string, unknown> = {
      organizationId: orgId,
      // Listings of soft-deleted recruiters disappear from the board.
      contact: { deletedAt: null },
    }

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { url: { contains: search } },
        { subtype: { contains: search } },
        { contact: { is: { OR: [{ firstName: { contains: search } }, { lastName: { contains: search } }, { emails: { contains: search } }] } } },
        { account: { is: { name: { contains: search } } } },
      ]
    }

    // Exact-value filters from the filter bar (each blank = no filter).
    const FILTER_KEYS = ['subtype', 'visibility', 'hiringStatus', 'premiumStatus', 'recruiterTag'] as const
    for (const key of FILTER_KEYS) {
      const v = url.searchParams.get(key)?.trim()
      if (v) where[key] = v
    }
    const accountId = url.searchParams.get('accountId')?.trim()
    if (accountId) where.accountId = accountId
    const minAppsRaw = url.searchParams.get('minApplications')
    if (minAppsRaw !== null && minAppsRaw !== '') {
      const minApplications = Number(minAppsRaw)
      if (Number.isFinite(minApplications)) where.totalApplications = { gte: minApplications }
    }
    const createdGte = url.searchParams.get('createdAt_gte')
    if (createdGte) where.createdAt = { ...(where.createdAt as object | undefined), gte: new Date(createdGte) }
    const createdLte = url.searchParams.get('createdAt_lte')
    if (createdLte) where.createdAt = { ...(where.createdAt as object | undefined), lte: new Date(createdLte) }

    const orderBy: Record<string, 'asc' | 'desc'>[] = []
    for (const part of sortParam.split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const desc = trimmed.startsWith('-')
      const field = desc ? trimmed.slice(1) : trimmed
      if (SORT_FIELDS.has(field)) orderBy.push({ [field]: desc ? 'desc' : 'asc' })
    }
    if (orderBy.length === 0) orderBy.push({ createdAt: 'desc' })

    const [items, total] = await Promise.all([
      db.contactListing.findMany({
        where: where as Prisma.ContactListingWhereInput,
        select: LISTING_SELECT,
        orderBy,
        take: limit + 1,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
      }),
      db.contactListing.count({ where: where as Prisma.ContactListingWhereInput }),
    ])

    const hasMore = items.length > limit
    const page = hasMore ? items.slice(0, limit) : items
    return NextResponse.json({
      items: page.map(serialize),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      total,
    })
  } catch (e) {
    const status = e instanceof Error && e.message === 'Unauthorized' ? 401
      : e instanceof Error && e.message === 'No organization' ? 403 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}
