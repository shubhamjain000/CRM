import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { audit } from '@/lib/auth/audit'
import { authenticateApiKey, requireScope } from '@/lib/api-keys'
import {
  handlePublicError,
  loadCustomFieldMap,
  ownerNameMap,
  parseListQuery,
  publicOk,
  serializeContact,
} from '../_helpers'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/public/v1/contacts — paginated, incremental-sync friendly list
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req)
    requireScope(auth, 'read')

    const query = parseListQuery(new URL(req.url))

    const where: Prisma.ContactWhereInput = {
      organizationId: auth.organizationId,
      deletedAt: null,
      ...(query.modifiedSince ? { updatedAt: { gte: query.modifiedSince } } : {}),
    }

    const [records, total] = await Promise.all([
      db.contact.findMany({
        where,
        include: { account: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      db.contact.count({ where }),
    ])

    const ids = records.map((r) => r.id)
    const [customFieldMap, ownerNames] = await Promise.all([
      loadCustomFieldMap(auth.organizationId, 'contact', ids),
      ownerNameMap(records.map((r) => r.ownerId)),
    ])

    return publicOk(
      records.map((r) => serializeContact(r, customFieldMap.get(r.id), ownerNames)),
      {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    )
  } catch (e) {
    return handlePublicError(e)
  }
}

// ---------------------------------------------------------------------------
// POST /api/public/v1/contacts — create (write scope)
// ---------------------------------------------------------------------------

/** Free-text string columns accepted on create: trimmed, ≤10 000 chars, '' → null. */
const STRING_FIELDS = [
  'lastName', 'title', 'department', 'leadSource', 'description',
  'typeOfLead', 'recruiterTriggers', 'company', 'employeeRange', 'linkedinUrl',
  'reachoutTat', 'hiringRoles', 'joiningTimeline', 'otherPlatformUsed',
  'recruiterFeedback', 'paidPlanPitch', 'postPitchLeadType', 'paidPlanFeedback',
  'addRecruiterName', 'addRecruiterDesignation', 'addRecruiterMobile',
  'csmStatus', 'csmRecruiterType',
] as const

/** Integer columns accepted on create (NaN/Infinity → null). */
const INT_FIELDS = [
  'totalOps', 'totalConversationsHad', 'livePremiumOps', 'totalReachoutsDone',
  'totalApplications', 'reasonableScoreUsers', 'relevantApplications', 'hiredCount',
] as const

/** Float column accepted on create. */
const FLOAT_FIELDS = ['reasonableFitPct'] as const

/** Date columns accepted on create (unparseable → null). */
const DATE_FIELDS = [
  'csmNextCallDate', 'dateApproved', 'firstConversationAt',
  'paidPlanPitchDate', 'paidPlanExpiryDate', 'lastReachedOutAt',
] as const

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 10000)
}

function cleanNumber(value: unknown, integer: boolean): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(n)) return null
  return integer ? Math.trunc(n) : n
}

function cleanDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateApiKey(req)
    requireScope(auth, 'write')

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }
    const payload = (body ?? {}) as Record<string, unknown>

    const firstName = typeof payload.firstName === 'string' ? payload.firstName.trim() : ''
    if (!firstName) {
      return NextResponse.json({ ok: false, error: 'firstName is required' }, { status: 400 })
    }

    // Owner resolution FIRST (ownerId is a required column): an explicit ownerId
    // must be an active member of the org; otherwise fall back to the key's
    // user, then to the org's first active member.
    let ownerId: string | null = null
    if (typeof payload.ownerId === 'string' && payload.ownerId) {
      const member = await db.tenantMembership.findFirst({
        where: { userId: payload.ownerId, organizationId: auth.organizationId, isActive: true },
        select: { userId: true },
      })
      if (member) ownerId = member.userId
    }
    if (!ownerId) {
      const own = await db.tenantMembership.findFirst({
        where: { userId: auth.userId, organizationId: auth.organizationId, isActive: true },
        select: { userId: true },
      })
      if (own) ownerId = own.userId
    }
    if (!ownerId) {
      const first = await db.tenantMembership.findFirst({
        where: { organizationId: auth.organizationId, isActive: true },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true },
      })
      if (first) ownerId = first.userId
    }
    if (!ownerId) {
      return NextResponse.json({ ok: false, error: 'Organization has no users' }, { status: 400 })
    }

    // Strict whitelist — unknown keys are ignored silently.
    const data: Prisma.ContactUncheckedCreateInput = {
      organizationId: auth.organizationId,
      firstName: firstName.slice(0, 10000),
      lastName: cleanString(payload.lastName) ?? '',
      ownerId,
    }
    for (const field of STRING_FIELDS) {
      const v = cleanString(payload[field])
      if (v !== null) data[field] = v
    }
    for (const field of INT_FIELDS) {
      const v = cleanNumber(payload[field], true)
      if (v !== null) data[field] = v
    }
    for (const field of FLOAT_FIELDS) {
      const v = cleanNumber(payload[field], false)
      if (v !== null) data[field] = v
    }
    for (const field of DATE_FIELDS) {
      const v = cleanDate(payload[field])
      if (v !== null) data[field] = v
    }

    // Single email/phone convenience → JSON-array-string columns.
    if (typeof payload.email === 'string' && payload.email.includes('@')) {
      data.emails = JSON.stringify([payload.email.trim()])
    }
    if (typeof payload.phone === 'string' && payload.phone.trim()) {
      data.phones = JSON.stringify([payload.phone.trim()])
    }

    const created = await db.contact.create({
      data,
      include: { account: { select: { name: true } } },
    })

    const ownerNames = await ownerNameMap([created.ownerId])
    const serialized = serializeContact(created, {}, ownerNames)

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const userAgent = req.headers.get('user-agent')
    await audit({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'api.contact.create',
      targetType: 'contact',
      targetId: created.id,
      ip,
      userAgent,
      metadata: { keyId: auth.apiKey.id, keyName: auth.apiKey.name },
    })

    return NextResponse.json({ ok: true, data: serialized }, { status: 201 })
  } catch (e) {
    return handlePublicError(e)
  }
}
