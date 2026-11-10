import { db } from '@/lib/db'
import { hasPermission } from '@/lib/auth/permissions'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'

/**
 * Field-level security (Tier 3 — the deferred Tier 1 item #7).
 *
 * Rules live in the FieldSecurity table: one row per (roleId, model, field)
 * with a level of 'hidden' | 'read_only' | 'visible'. Absence of a rule means
 * the field is fully visible AND writable — so orgs that never configure a
 * rule see zero behavior change.
 *
 *   hidden     → field is removed from every read (list/detail/export) and
 *                stripped from every write through the API boundary
 *   read_only  → field is readable but stripped from writes
 *   visible    → no restriction (used by the UI; POSTing it deletes the rule)
 *
 * Admins (org.admin, incl. inherited) always bypass. Internal system flows
 * (lead conversion, workflow actions, assignment rules) are NOT filtered —
 * enforcement happens at the API boundary and on list reads only.
 */

export type FieldSecurityLevel = 'hidden' | 'read_only' | 'visible'

export const FIELD_SECURITY_MODELS = ['lead', 'contact', 'account', 'deal'] as const
export type FieldSecurityModel = (typeof FIELD_SECURITY_MODELS)[number]

/** Curated catalog of restrictable fields per model (drives API validation + UI matrix). */
export const FIELD_CATALOG: Record<FieldSecurityModel, string[]> = {
  lead: ['firstName', 'lastName', 'company', 'title', 'emails', 'phones', 'website', 'leadStatus', 'rating', 'score', 'leadSource', 'industry', 'annualRevenue', 'employees', 'description', 'ownerId'],
  contact: ['firstName', 'lastName', 'title', 'department', 'emails', 'phones', 'accountId', 'leadSource', 'description', 'ownerId'],
  account: ['name', 'accountNumber', 'accountType', 'industry', 'website', 'annualRevenue', 'employees', 'rating', 'ownership', 'description', 'ownerId'],
  deal: ['name', 'amount', 'currency', 'type', 'leadSource', 'probability', 'closeDate', 'nextStep', 'accountId', 'description', 'ownerId', 'stageId'],
}

export const FIELD_SECURITY_LEVELS: FieldSecurityLevel[] = ['visible', 'read_only', 'hidden']

interface CacheEntry {
  /** model → field → level */
  rules: Record<string, Record<string, FieldSecurityLevel>>
  exp: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 15_000

export function invalidateFieldSecurityCache(roleId?: string): void {
  if (roleId) cache.delete(roleId)
  else cache.clear()
}

/** model → field → level map for a role (15s cache; empty = no restrictions). */
export async function getFieldRulesForRole(roleId: string): Promise<Record<string, Record<string, FieldSecurityLevel>>> {
  const hit = cache.get(roleId)
  if (hit && hit.exp > Date.now()) return hit.rules
  const rows = await db.fieldSecurity.findMany({ where: { roleId } })
  const rules: Record<string, Record<string, FieldSecurityLevel>> = {}
  for (const r of rows) {
    if (!(r.model in FIELD_CATALOG)) continue
    rules[r.model] = rules[r.model] ?? {}
    rules[r.model][r.field] = r.level === 'hidden' || r.level === 'read_only' ? r.level : 'visible'
  }
  cache.set(roleId, { rules, exp: Date.now() + TTL_MS })
  return rules
}

/** Remove `hidden` fields from records for a non-admin role (shallow clones). */
export async function maskRecordsForRead<T extends Record<string, unknown>>(
  model: string,
  records: T[],
  roleId: string,
): Promise<T[]> {
  const rules = await getFieldRulesForRole(roleId)
  const forModel = rules[model]
  if (!forModel) return records
  const hidden = Object.entries(forModel).filter(([, level]) => level === 'hidden').map(([field]) => field)
  if (hidden.length === 0) return records
  // Admins bypass
  if (await hasPermission(roleId, 'org.admin')) return records
  return records.map((rec) => {
    const clone = { ...rec }
    for (const f of hidden) delete clone[f]
    return clone
  })
}

/** Strip fields the role may not write. Returns the cleaned payload + what was blocked. */
export async function filterWritableFields(
  model: string,
  data: Record<string, unknown>,
  roleId: string,
): Promise<{ data: Record<string, unknown>; blocked: string[] }> {
  const rules = await getFieldRulesForRole(roleId)
  const forModel = rules[model]
  if (!forModel) return { data, blocked: [] }
  if (await hasPermission(roleId, 'org.admin')) return { data, blocked: [] }
  const clone = { ...data }
  const blocked: string[] = []
  for (const [field, level] of Object.entries(forModel)) {
    if (field in clone && level !== 'visible') {
      delete clone[field]
      blocked.push(field)
    }
  }
  return { data: clone, blocked }
}

/** Throws when EVERY submitted field was blocked — a silent no-op write would confuse users. */
export function assertWritablePayload(data: Record<string, unknown>, blocked: string[]): void {
  if (blocked.length > 0 && Object.keys(data).length === 0) {
    throw new Error(`Your role cannot edit these fields: ${blocked.join(', ')}`)
  }
}

// ---------------------------------------------------------------------------
// Caller-context convenience wrappers (used at the API boundary in routes.ts
// / detail-routes.ts). Internal system flows (conversion, workflows) call the
// CRM handler directly and intentionally bypass these.
// ---------------------------------------------------------------------------

/** Filter a write payload for the current session's role. */
export async function filterWritableForCaller(
  model: string,
  data: Record<string, unknown>,
): Promise<{ data: Record<string, unknown>; blocked: string[] }> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) return { data, blocked: [] }
  return filterWritableFields(model, data, tenant.role.id)
}

/** Mask a single record's `hidden` fields for the current session's role. */
export async function maskRecordForCaller<T extends Record<string, unknown>>(model: string, record: T): Promise<T> {
  const session = await getSession()
  if (!session) return record
  const tenant = await getTenant(session.userId)
  if (!tenant) return record
  const [masked] = await maskRecordsForRead(model, [record], tenant.role.id)
  return masked ?? record
}
