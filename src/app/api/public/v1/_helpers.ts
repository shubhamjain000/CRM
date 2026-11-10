import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiAuthError } from '@/lib/api-keys'

/**
 * Shared helpers for the public v1 REST API (API-key authenticated).
 * Response envelope:
 *   list   → { ok: true, data: [...], pagination: { page, limit, total, totalPages } }
 *   single → { ok: true, data: { ...record } }
 *   error  → { ok: false, error: 'message' }
 */

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export function publicOk(data: unknown, pagination?: Pagination) {
  return NextResponse.json(pagination ? { ok: true, data, pagination } : { ok: true, data })
}

export function publicFail(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

/** Map thrown errors to the public envelope (ApiAuthError carries its status). */
export function handlePublicError(e: unknown) {
  if (e instanceof ApiAuthError) return publicFail(e.message, e.status)
  console.error('[public-api] unexpected error', e)
  return publicFail('Internal server error', 500)
}

export interface ParsedListQuery {
  page: number
  limit: number
  skip: number
  take: number
  modifiedSince: Date | null
}

/** Parse page/limit/modified_since query params with spec defaults + limits. */
export function parseListQuery(url: URL): ParsedListQuery {
  const rawPage = parseInt(url.searchParams.get('page') ?? '', 10)
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50

  const rawSince = url.searchParams.get('modified_since')
  let modifiedSince: Date | null = null
  if (rawSince) {
    const d = new Date(rawSince)
    if (Number.isNaN(d.getTime())) {
      throw new ApiAuthError('Invalid modified_since datetime', 400)
    }
    modifiedSince = d
  }

  return { page, limit, skip: (page - 1) * limit, take: limit, modifiedSince }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Parse a JSON-array string column (emails/phones/listingCategory); [] on failure. */
function parseJsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Recursively convert Date instances to ISO strings so the JSON output is explicit. */
function datesToIso<T>(value: T): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((v) => datesToIso(v))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = datesToIso(v)
    }
    return out
  }
  return value
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

/** Merge active custom-field values for the given records: recordId → { apiName: value }. */
export async function loadCustomFieldMap(
  organizationId: string,
  module: 'lead' | 'contact' | 'account' | 'deal',
  recordIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>()
  if (recordIds.length === 0) return map

  const fields = await db.customField.findMany({
    where: { organizationId, module, isActive: true },
    select: { id: true, apiName: true },
  })
  if (fields.length === 0) return map

  const values = await db.customFieldValue.findMany({
    where: {
      organizationId,
      module,
      recordId: { in: recordIds },
      fieldId: { in: fields.map((f) => f.id) },
    },
    select: { recordId: true, fieldId: true, value: true },
  })

  const apiNameByFieldId = new Map(fields.map((f) => [f.id, f.apiName]))
  for (const v of values) {
    const apiName = apiNameByFieldId.get(v.fieldId)
    if (!apiName) continue
    const entry = map.get(v.recordId) ?? {}
    entry[apiName] = safeJsonParse(v.value)
    map.set(v.recordId, entry)
  }
  return map
}

/** Batch-resolve owner display names (ownerId → user.name). The Contact/Lead/Deal
 * models store ownerId as a plain string column, so there is no Prisma relation
 * to include — this map is flattened onto serialized rows as `ownerName`. */
export async function ownerNameMap(ownerIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(ownerIds.filter((id): id is string => !!id))]
  if (ids.length === 0) return new Map()
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  })
  return new Map(users.map((u) => [u.id, u.name]))
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

export type ContactWithAccount = Prisma.ContactGetPayload<{
  include: { account: { select: { name: true } } }
}>

export type LeadRecord = Prisma.LeadGetPayload<Record<string, never>>

export type DealWithRelations = Prisma.DealGetPayload<{
  include: {
    account: { select: { name: true } }
    stage: { select: { name: true } }
    pipeline: { select: { name: true } }
  }
}>

export function serializeContact(
  record: ContactWithAccount,
  customFields: Record<string, unknown> | undefined,
  ownerNames: Map<string, string>,
): Record<string, unknown> {
  const { account, ...rest } = record
  const base = datesToIso(rest) as Record<string, unknown>
  return {
    ...base,
    emails: parseJsonArray(record.emails),
    phones: parseJsonArray(record.phones),
    listingCategory: parseJsonArray(record.listingCategory),
    accountName: account?.name ?? null,
    ownerName: ownerNames.get(record.ownerId) ?? null,
    customFields: customFields ?? {},
  }
}

export function serializeLead(
  record: LeadRecord,
  customFields: Record<string, unknown> | undefined,
  ownerNames: Map<string, string>,
): Record<string, unknown> {
  const base = datesToIso(record) as Record<string, unknown>
  return {
    ...base,
    emails: parseJsonArray(record.emails),
    phones: parseJsonArray(record.phones),
    ownerName: ownerNames.get(record.ownerId) ?? null,
    customFields: customFields ?? {},
  }
}

export function serializeDeal(
  record: DealWithRelations,
  customFields: Record<string, unknown> | undefined,
  ownerNames: Map<string, string>,
): Record<string, unknown> {
  const { account, stage, pipeline, ...rest } = record
  const base = datesToIso(rest) as Record<string, unknown>
  return {
    ...base,
    accountName: account?.name ?? null,
    stageName: stage?.name ?? null,
    pipelineName: pipeline?.name ?? null,
    ownerName: ownerNames.get(record.ownerId) ?? null,
    customFields: customFields ?? {},
  }
}
