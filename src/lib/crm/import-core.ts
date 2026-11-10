import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { applyAssignmentRules, recordAssignment } from '@/lib/crm/assignment'

/**
 * Shared import engine — the single pipeline that turns raw rows into CRM
 * records. Consumed by BOTH the UI Import Wizard (/api/crm/import) and the
 * API auto-import connector (src/lib/integrations/api-import.ts), so records
 * created by a connected endpoint flow through exactly the same validation,
 * dedupe, account resolution and assignment rules as a manual CSV upload.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const MAX_IMPORT_ROWS = 5000

type FieldType = 'string' | 'number' | 'int' | 'bool' | 'email-list' | 'phone-list' | 'date' | 'datetime'

export interface FieldSpec {
  type: FieldType
  required?: boolean
  maxLen?: number
  enumValues?: string[]
  default?: string | number
  /** Normalize a raw CSV cell before coercion (e.g. premium "yes" → "Paid"). */
  mapValue?: (raw: string) => string
  /** When an enum match fails, store null instead of failing the whole row. */
  lenientEnum?: boolean
}

export const IMPORT_SPECS: Record<string, Record<string, FieldSpec>> = {
  lead: {
    firstName: { type: 'string', required: true, maxLen: 100 },
    lastName: { type: 'string', required: true, maxLen: 100 },
    company: { type: 'string', maxLen: 200 },
    title: { type: 'string', maxLen: 120 },
    leadSource: { type: 'string', maxLen: 120 },
    leadStatus: { type: 'string', enumValues: ['new', 'contacted', 'qualified', 'unqualified', 'converted'], default: 'new' },
    rating: { type: 'string', enumValues: ['hot', 'warm', 'cold'] },
    industry: { type: 'string', maxLen: 120 },
    website: { type: 'string', maxLen: 300 },
    annualRevenue: { type: 'number' },
    employees: { type: 'int' },
    score: { type: 'number' },
    description: { type: 'string', maxLen: 5000 },
    emails: { type: 'email-list' },
    phones: { type: 'phone-list' },
  },
  contact: {
    firstName: { type: 'string', required: true, maxLen: 100 },
    // Not required anymore: a mapped "Full name" column is split into
    // first/last server-side, and single-word names only need an email.
    // default '' keeps the NOT NULL lastName column satisfied on create.
    lastName: { type: 'string', maxLen: 100, default: '' },
    title: { type: 'string', maxLen: 120 },
    department: { type: 'string', maxLen: 120 },
    leadSource: { type: 'string', maxLen: 120 },
    description: { type: 'string', maxLen: 5000 },
    emails: { type: 'email-list' },
    phones: { type: 'phone-list' },
    // Listing Intelligence (additive, all optional)
    recruiterTag: {
      type: 'string', enumValues: ['New Recruiter', 'Existing Recruiter'], lenientEnum: true,
    },
    premiumStatus: {
      type: 'string', enumValues: ['Free', 'Paid'], lenientEnum: true,
      mapValue: premiumCsvValue,
    },
    listingSubtype: {
      type: 'string', enumValues: ['Jobs', 'Internships'], lenientEnum: true,
      mapValue: (v) => {
        const lower = v.toLowerCase()
        if (lower === 'job' || lower === 'jobs') return 'Jobs'
        if (lower === 'internship' || lower === 'internships') return 'Internships'
        return v
      },
    },
    totalApplications: { type: 'int' },
    reasonableFitPct: { type: 'number', mapValue: (v) => v.replace(/%\s*$/, '').trim() },
    reasonableScoreUsers: { type: 'int' },
    listingUrl: { type: 'string', maxLen: 500 },
    listingTitle: { type: 'string', maxLen: 300 },
    listingCategory: { type: 'string', maxLen: 1000, mapValue: listingCategoryCsvValue },
    dateApproved: { type: 'datetime' },
    visibility: {
      type: 'string', enumValues: ['Public', 'Private'], lenientEnum: true,
      mapValue: (v) => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase(),
    },
    hiringStatus: { type: 'string', maxLen: 80 },
    relevantApplications: { type: 'int' },
    hiredCount: { type: 'int' },
    csmRecruiterType: { type: 'string', enumValues: ['First Time', 'Existing', 'New'] },
    csmStatus: { type: 'string', maxLen: 200 },
    csmNextCallDate: { type: 'date' },
    totalReachoutsDone: { type: 'int' },
    lastReachedOutAt: { type: 'datetime' },
  },
  account: {
    name: { type: 'string', required: true, maxLen: 200 },
    accountNumber: { type: 'string', maxLen: 80 },
    accountType: { type: 'string', enumValues: ['customer', 'prospect', 'partner', 'competitor', 'vendor'], default: 'prospect' },
    industry: { type: 'string', maxLen: 120 },
    website: { type: 'string', maxLen: 300 },
    annualRevenue: { type: 'number' },
    employees: { type: 'int' },
    rating: { type: 'string', maxLen: 40 },
    ownership: { type: 'string', maxLen: 80 },
    tickerSymbol: { type: 'string', maxLen: 20 },
    sicCode: { type: 'string', maxLen: 20 },
  },
  deal: {
    name: { type: 'string', required: true, maxLen: 200 },
    amount: { type: 'number', default: 0 },
    currency: { type: 'string', maxLen: 8 },
    closeDate: { type: 'date' },
    probability: { type: 'number' },
    leadSource: { type: 'string', maxLen: 120 },
    type: { type: 'string', enumValues: ['new_business', 'existing_business', 'renewal'], default: 'new_business' },
    nextStep: { type: 'string', maxLen: 200 },
    description: { type: 'string', maxLen: 5000 },
  },
}

type RowError = { row: number; reason: string }

/** CSV "premium" column → canonical Free/Paid (yes/paid/true → Paid, no/free/false → Free). */
function premiumCsvValue(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (['paid', 'yes', 'y', 'true', '1', 'premium'].includes(v)) return 'Paid'
  if (['free', 'no', 'n', 'false', '0', 'non-paid', 'nonpaid'].includes(v)) return 'Free'
  return raw.trim()
}

/**
 * CSV "category" cell → JSON-array-string. Handles every shape the daily
 * listing export produces:
 *  - Postgres-style array text: ["Fresher"] / ["Arts, Commerce, Sciences & Others" "Engineering Students"]
 *    (quoted labels separated by spaces — labels may themselves contain commas)
 *  - JSON arrays: ["Fresher","Engineering Students"]
 *  - plain values, optionally multiple split on | or ;
 */
function listingCategoryCsvValue(raw: string): string {
  const trimmed = raw.trim()
  let list: string[] = []
  if (/^\[.*\]$/.test(trimmed)) {
    // Bracketed array text — extract each quoted label; fall back to a
    // whitespace/comma split when a bracketed cell has no quoting at all.
    const inner = trimmed.slice(1, -1)
    list = [...inner.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim()).filter(Boolean)
    if (list.length === 0) {
      list = inner.split(/[\s,]+/).map((p) => p.trim().replace(/^"|"$/g, '')).filter(Boolean)
    }
  } else {
    const parts = trimmed.split(/[|;]/).map((p) => p.trim()).filter(Boolean)
    list = parts.length > 0 ? parts : (trimmed ? [trimmed] : [])
  }
  return list.length > 0 ? JSON.stringify(list) : ''
}

function toList(raw: unknown, kind: 'email' | 'phone'): { list: string[]; invalid: string[] } {
  const arr = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[,;|]/)
  const out: string[] = []
  const invalid: string[] = []
  for (const item of arr) {
    const v = item.trim()
    if (!v) continue
    if (kind === 'email' && !EMAIL_RE.test(v)) { invalid.push(v); continue }
    if (kind === 'phone' && v.length > 40) { invalid.push(v); continue }
    if (!out.includes(v)) out.push(v)
    if (out.length >= 5) break
  }
  return { list: out, invalid }
}

function coerce(spec: FieldSpec, raw: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (raw === undefined || raw === null || raw === '') {
    if (spec.required) return { ok: false, reason: 'Required field is empty' }
    if (spec.default !== undefined) return { ok: true, value: spec.default }
    return { ok: true, value: null }
  }
  switch (spec.type) {
    case 'string': {
      const v = spec.mapValue ? spec.mapValue(String(raw).trim()) : String(raw).trim()
      if (!v && spec.required) return { ok: false, reason: 'Required field is empty' }
      if (spec.enumValues) {
        const lower = v.toLowerCase()
        const match = spec.enumValues.find((e) => e.toLowerCase() === lower)
        if (!match) {
          if (spec.lenientEnum) return { ok: true, value: null }
          return { ok: false, reason: `Invalid value "${v.slice(0, 40)}" — expected one of: ${spec.enumValues.join(', ')}` }
        }
        return { ok: true, value: match }
      }
      return { ok: true, value: v.slice(0, spec.maxLen ?? 500) || null }
    }
    case 'number': {
      const cleaned = spec.mapValue ? spec.mapValue(String(raw).trim()) : String(raw)
      const n = Number(cleaned.replace(/[,$\s]/g, ''))
      if (Number.isNaN(n)) return { ok: false, reason: `Invalid number: "${String(raw).slice(0, 40)}"` }
      return { ok: true, value: n }
    }
    case 'int': {
      const cleaned = spec.mapValue ? spec.mapValue(String(raw).trim()) : String(raw)
      const n = parseInt(cleaned.replace(/[,$\s]/g, ''), 10)
      if (Number.isNaN(n)) return { ok: false, reason: `Invalid integer: "${String(raw).slice(0, 40)}"` }
      return { ok: true, value: n }
    }
    case 'bool':
      return { ok: true, value: ['true', '1', 'yes', 'y'].includes(String(raw).toLowerCase()) }
    case 'date': {
      const d = new Date(String(raw))
      if (Number.isNaN(d.getTime())) return { ok: false, reason: `Invalid date: "${String(raw).slice(0, 40)}" (use YYYY-MM-DD)` }
      return { ok: true, value: d }
    }
    case 'datetime': {
      // Accepts 'YYYY-MM-DD' and 'YYYY-MM-DD HH:mm[:ss]' (space → T keeps
      // V8 + spec happy) as well as verbose export formats like
      // 'November 2, 2026, 6:24 PM' — those must go to Date() untouched
      // (the space→T swap would corrupt them beyond the first space).
      const rawStr = String(raw).trim()
      const isoLike = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(rawStr)
      const d = isoLike ? new Date(rawStr.replace(' ', 'T')) : new Date(rawStr)
      if (Number.isNaN(d.getTime())) {
        return { ok: false, reason: `Invalid date: "${rawStr.slice(0, 40)}" (use YYYY-MM-DD or YYYY-MM-DD HH:mm:ss)` }
      }
      return { ok: true, value: d }
    }
    case 'email-list': {
      const rawStr = String(raw).trim()
      const { list } = toList(raw, 'email')
      // A non-empty email column must contain at least one valid email — otherwise fail the row
      if (rawStr && list.length === 0) return { ok: false, reason: `No valid email in "${rawStr.slice(0, 60)}"` }
      return { ok: true, value: JSON.stringify(list) }
    }
    case 'phone-list': {
      const { list } = toList(raw, 'phone')
      return { ok: true, value: JSON.stringify(list) }
    }
    default:
      return { ok: true, value: String(raw) }
  }
}

function safeParseList(v: unknown): string[] {
  if (typeof v !== 'string') return []
  try {
    const p = JSON.parse(v)
    return Array.isArray(p) ? p.map(String) : []
  } catch {
    return []
  }
}

/**
 * Fields allowed to overwrite an EXISTING contact on re-import
 * (updateExisting=true): the Listing Intelligence columns + title (part of
 * the daily listing data). Names, emails, phones, department, description,
 * the account link and every CSM-managed field (csmRecruiterType, csmStatus,
 * csmNextCallDate) are NEVER overwritten. Values are only applied when
 * non-empty (rec values are already null-free, guarded again here for
 * safety).
 */
const CONTACT_UPDATE_FIELDS = [
  'title',
  'recruiterTag', 'premiumStatus', 'listingSubtype', 'totalApplications',
  'reasonableFitPct', 'reasonableScoreUsers', 'listingUrl', 'listingTitle',
  'listingCategory', 'dateApproved', 'visibility', 'hiringStatus',
  'relevantApplications', 'hiredCount',
] as const

function buildContactUpdateData(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of CONTACT_UPDATE_FIELDS) {
    const v = rec[k]
    if (v !== undefined && v !== null && v !== '') out[k] = v
  }
  return out
}

export interface ImportOutcome {
  created: number
  updated: number
  skipped: number
  failed: number
  /** contact module: listing-history entries ADDED (same email, new listing link) */
  listingsAdded: number
  /** contact module: company accounts auto-created during this import */
  accountsCreated: number
  errors: RowError[]
}

/**
 * Run a batch of raw rows through the full import pipeline (validate → dedupe
 * → account resolution → assignment rules → insert/update). `actorId` is the
 * fallback owner / audit actor — for API auto-imports that is the connector
 * config's chosen owner (the user who set the connection up).
 *
 * Contact module — long-term listing accumulation semantics:
 *  - A company name that is not in Accounts yet is auto-created, so every
 *    contact/listing of the same company (any listing link) lands in ONE
 *    account forever.
 *  - A row whose email matches an existing contact but whose listing link is
 *    NEW adds a listing-history entry (ContactListing) — the 2nd, 3rd…
 *    listing for that recruiter over time. Only the exact same email+link is
 *    treated as a duplicate (skipped, or refreshed when updateExisting=true).
 *  - The contact's own listing* columns always mirror the latest listing.
 */
export async function processImportRows(input: {
  orgId: string
  actorId: string
  module: string
  rows: Record<string, unknown>[]
  updateExisting?: boolean
}): Promise<ImportOutcome> {
  const orgId = input.orgId
  const actorId = input.actorId
  const moduleName = input.module
  const rows = input.rows
  const updateExisting = input.updateExisting === true
  const spec = IMPORT_SPECS[moduleName]
  const errors: RowError[] = []
  let skipped = 0
  // Informational notices (skipped duplicates, no-op updates, account-link
  // warnings). They are merged into the same `errors` issues list returned
  // to the caller, but `failed` keeps counting only hard failures.
  const notices: RowError[] = []
  const valid: { rec: Record<string, unknown>; key: string; identity: string; rowNum: number; lookupName: string }[] = []
  const dedupeKeys = new Set<string>()

  // --- Pre-fetch org accounts once for accountName resolution + account dedupe (case-insensitive in JS; SQLite `in` is case-sensitive) ---
  let accountsByLowerName = new Map<string, { id: string; name: string }>()
  const needsAccounts = (moduleName === 'contact' || moduleName === 'deal') && rows.some((r) => typeof r.accountName === 'string' && r.accountName.trim())
    || moduleName === 'account'
  if (needsAccounts) {
    const accts = await db.account.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, name: true },
      take: 10000,
    })
    accountsByLowerName = new Map(accts.map((a) => [a.name.toLowerCase(), { id: a.id, name: a.name }]))
  }

  // --- Default pipeline + first stage for deal imports ---
  let defaultStageId: string | null = null
  let defaultPipelineId: string | null = null
  if (moduleName === 'deal') {
    const pipeline = await db.pipeline.findFirst({
      where: { organizationId: orgId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { order: 'asc' }],
      include: { stages: { orderBy: { order: 'asc' }, take: 1 } },
    })
    defaultPipelineId = pipeline?.id ?? null
    defaultStageId = pipeline?.stages[0]?.id ?? null
  }

  // --- Normalize + validate every row ---
  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i]
    const rowNum = i + 1
    const rec: Record<string, unknown> = {}

    // Convenience: email/phone singular -> list fields
    if (rawRow.email !== undefined && rawRow.emails === undefined) rawRow.emails = rawRow.email
    if (rawRow.phone !== undefined && rawRow.phones === undefined) rawRow.phones = rawRow.phone

    // Convenience: raw CSV headers from the daily listing export — accepted
    // directly so the API path matches the documented column names (the
    // import wizard usually maps them, but raw payloads work too).
    if (moduleName === 'contact') {
      if (rawRow.full_name !== undefined && rawRow.fullName === undefined) rawRow.fullName = rawRow.full_name
      if (rawRow.email_id !== undefined && rawRow.emails === undefined) rawRow.emails = rawRow.email_id
      if (rawRow.mobile_no !== undefined && rawRow.phones === undefined) rawRow.phones = rawRow.mobile_no
      // Listing Intelligence columns (snake_case CSV headers → field names)
      if (rawRow.recruiter_tag !== undefined && rawRow.recruiterTag === undefined) rawRow.recruiterTag = rawRow.recruiter_tag
      if (rawRow.premium !== undefined && rawRow.premiumStatus === undefined) rawRow.premiumStatus = rawRow.premium
      if (rawRow.subtype !== undefined && rawRow.listingSubtype === undefined) rawRow.listingSubtype = rawRow.subtype
      if (rawRow.applications !== undefined && rawRow.totalApplications === undefined) rawRow.totalApplications = rawRow.applications
      if (rawRow['reasonable_fit_%'] !== undefined && rawRow.reasonableFitPct === undefined) rawRow.reasonableFitPct = rawRow['reasonable_fit_%']
      if (rawRow.reasonable_fit_pct !== undefined && rawRow.reasonableFitPct === undefined) rawRow.reasonableFitPct = rawRow.reasonable_fit_pct
      if (rawRow.reasonable_score_users !== undefined && rawRow.reasonableScoreUsers === undefined) rawRow.reasonableScoreUsers = rawRow.reasonable_score_users
      if (rawRow.listing_link !== undefined && rawRow.listingUrl === undefined) rawRow.listingUrl = rawRow.listing_link
      if (rawRow.listing_title !== undefined && rawRow.listingTitle === undefined) rawRow.listingTitle = rawRow.listing_title
      if (rawRow.category !== undefined && rawRow.listingCategory === undefined) rawRow.listingCategory = rawRow.category
      if (rawRow.date_approved !== undefined && rawRow.dateApproved === undefined) rawRow.dateApproved = rawRow.date_approved
      if (rawRow.hired_count !== undefined && rawRow.hiredCount === undefined) rawRow.hiredCount = rawRow.hired_count
      if (rawRow.hiring_status !== undefined && rawRow.hiringStatus === undefined) rawRow.hiringStatus = rawRow.hiring_status
      if (rawRow.relevant_applications !== undefined && rawRow.relevantApplications === undefined) rawRow.relevantApplications = rawRow.relevant_applications
    }

    // Convenience (lead + contact): "Full name" splits on the first space
    // when the row lacks explicit first/last name columns.
    if (moduleName === 'lead' || moduleName === 'contact') {
      const hasFirst = typeof rawRow.firstName === 'string' && rawRow.firstName.trim() !== ''
      const hasLast = typeof rawRow.lastName === 'string' && rawRow.lastName.trim() !== ''
      if ((!hasFirst || !hasLast) && typeof rawRow.fullName === 'string' && rawRow.fullName.trim() !== '') {
        const parts = rawRow.fullName.trim().split(/\s+/)
        if (!hasFirst) rawRow.firstName = parts[0] ?? ''
        if (!hasLast) rawRow.lastName = parts.slice(1).join(' ')
      }
      // Recruiter exports (daily listing dumps) often carry rows with a
      // perfectly valid email but NO name at all ("hr@blackbucks.me"). The
      // identity is the email anyway — derive a display name from the email's
      // local part so the row imports instead of hard-failing on the
      // required first name.
      const hasFirstNow = typeof rawRow.firstName === 'string' && rawRow.firstName.trim() !== ''
      if (!hasFirstNow) {
        let firstEmailRaw = String(rawRow.emails ?? '')
        // The API connector path may pass emails as a JSON list.
        if (firstEmailRaw.startsWith('[')) firstEmailRaw = safeParseList(firstEmailRaw)[0] ?? ''
        const firstEmail = firstEmailRaw.split(/[,;|]/)[0]?.trim() ?? ''
        if (firstEmail.includes('@')) {
          // Keep letters only (digits, separators and JSON noise vanish).
          const cleaned = firstEmail.split('@')[0].replace(/[^a-zA-Z\s]+/g, ' ').trim()
          const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
          const parts = cleaned.split(/\s+/).filter(Boolean).map(cap)
          rawRow.firstName = parts[0] ?? ''
          rawRow.lastName = parts.slice(1).join(' ')
          // Local part was noise (all digits/punctuation) — fall back to the
          // company name, then a generic label, so the row still imports.
          if (!rawRow.firstName) {
            const company = typeof rawRow.accountName === 'string' ? rawRow.accountName.trim() : ''
            const companyParts = company.split(/\s+/).filter(Boolean)
            rawRow.firstName = companyParts[0] ?? 'Recruiter'
            rawRow.lastName = companyParts.slice(1).join(' ')
          }
        }
      }
    }

    let failed = false
    for (const [field, fSpec] of Object.entries(spec)) {
      const res = coerce(fSpec, rawRow[field])
      if (!res.ok) { errors.push({ row: rowNum, reason: `${field}: ${res.reason}` }); failed = true; break }
      if (res.value !== null) rec[field] = res.value
    }
    if (failed) continue

    // Account lookup resolution (contact/deal)
    if (moduleName === 'contact' || moduleName === 'deal') {
      const acctName = typeof rawRow.accountName === 'string' ? rawRow.accountName.trim() : ''
      if (acctName) {
        const acct = accountsByLowerName.get(acctName.toLowerCase())
        if (!acct) {
          if (moduleName === 'contact') {
            // Company not in Accounts yet — mark it for auto-creation so
            // every row with the same company name (regardless of listing
            // link) lands in ONE account. Created before the insert phase.
            rec.__pendingAccountName = acctName
          } else {
            errors.push({ row: rowNum, reason: `Account "${acctName.slice(0, 60)}" not found — import accounts first or clear the column` })
            continue
          }
        } else {
          rec.accountId = acct.id
        }
      }
    }

    // Deal: pipeline/stage resolution
    if (moduleName === 'deal') {
      if (!defaultPipelineId || !defaultStageId) {
        errors.push({ row: rowNum, reason: 'No active pipeline with stages exists — create a pipeline first' })
        continue
      }
      rec.pipelineId = defaultPipelineId
      rec.stageId = defaultStageId
    }

    // Dedupe keys:
    //  - identity — how existing records are looked up (email for
    //    leads/contacts, name for accounts/deals)
    //  - key — the in-file dedupe key. For contacts it INCLUDES the listing
    //    link, so the same recruiter appearing on several listings in one
    //    file is NOT a duplicate — only the exact same email+link is.
    let identity = ''
    let key = ''
    let lookupName = ''
    if (moduleName === 'lead' || moduleName === 'contact') {
      const emails = safeParseList(rec.emails)
      identity = emails[0]?.toLowerCase() ?? `${String(rec.firstName ?? '').toLowerCase()}|${String(rec.lastName ?? '').toLowerCase()}`
      if (!emails[0] && (!rec.firstName || !rec.lastName)) {
        errors.push({ row: rowNum, reason: 'Provide at least first+last name or an email' })
        continue
      }
      const listingUrl = typeof rec.listingUrl === 'string' ? rec.listingUrl.trim().toLowerCase() : ''
      key = moduleName === 'contact' && listingUrl ? `${identity}|${listingUrl}` : identity
      lookupName = emails[0] ?? ''
    } else if (moduleName === 'account') {
      identity = key = `account|${String(rec.name ?? '').toLowerCase()}`
      lookupName = String(rec.name ?? '')
    } else {
      identity = key = `deal|${String(rec.name ?? '').toLowerCase()}|${rec.accountId ?? ''}`
      lookupName = String(rec.name ?? '')
    }
    if (dedupeKeys.has(key)) {
      // Same record appears twice in the file — the first occurrence wins and
      // the repeat is reported as a SKIPPED duplicate, not a hard failure.
      skipped++
      notices.push({ row: rowNum, reason: `Duplicate row inside file — first occurrence kept: ${key.slice(8, 68)}` })
      continue
    }
    dedupeKeys.add(key)
    valid.push({ rec, key, identity, rowNum, lookupName })
  }

  // --- Existing-record dedupe within org (case-insensitive, in-memory) ---
  const existingMap = new Map<string, { id: string; accountId: string | null }>()
  if (valid.length > 0) {
    if (moduleName === 'account') {
      for (const [lower, acct] of accountsByLowerName) existingMap.set(`account|${lower}`, { id: acct.id, accountId: null })
    } else if (moduleName === 'deal') {
      const names = [...new Set(valid.map((v) => v.lookupName).filter(Boolean))]
      if (names.length > 0) {
        const found = await db.deal.findMany({
          where: { organizationId: orgId, deletedAt: null, name: { in: names } },
          select: { id: true, name: true, accountId: true },
          take: 10000,
        })
        for (const f of found) existingMap.set(`deal|${f.name.toLowerCase()}|${f.accountId ?? ''}`, { id: f.id, accountId: f.accountId ?? null })
      }
    } else {
      // lead/contact: match by email (primary identity)
      const model: any = moduleName === 'lead' ? db.lead : db.contact
      const found = await model.findMany({
        where: { organizationId: orgId, deletedAt: null, emails: { not: '[]' } },
        select: { id: true, emails: true, accountId: true },
        take: 10000,
      })
      const emailToId = new Map<string, { id: string; accountId: string | null }>()
      for (const f of found) for (const e of safeParseList(f.emails)) if (!emailToId.has(e.toLowerCase())) emailToId.set(e.toLowerCase(), { id: f.id, accountId: f.accountId ?? null })
      for (const v of valid) {
        if (v.identity.includes('@') && emailToId.has(v.identity)) existingMap.set(v.identity, emailToId.get(v.identity)!)
      }
    }
  }

  // --- Contact listing-history prefetch: contactId → (lower link → listing id) ---
  const listingsByUrl = new Map<string, Map<string, string>>()
  if (moduleName === 'contact' && existingMap.size > 0) {
    const matchedIds = [...new Set([...existingMap.values()].map((e) => e.id))]
    if (matchedIds.length > 0) {
      const found = await db.contactListing.findMany({
        where: { organizationId: orgId, contactId: { in: matchedIds } },
        select: { id: true, contactId: true, url: true },
        take: 20000,
      })
      for (const l of found) {
        if (!l.url) continue
        if (!listingsByUrl.has(l.contactId)) listingsByUrl.set(l.contactId, new Map())
        listingsByUrl.get(l.contactId)!.set(l.url.toLowerCase(), l.id)
      }
    }
  }

  // --- Contact accounts: auto-create companies that are not in Accounts yet ---
  let accountsCreated = 0
  if (moduleName === 'contact') {
    const pendingNames = new Set<string>()
    for (const v of valid) {
      const name = v.rec.__pendingAccountName
      if (typeof name === 'string' && name.trim()) pendingNames.add(name.trim())
    }
    for (const name of pendingNames) {
      const lower = name.toLowerCase()
      if (accountsByLowerName.has(lower)) continue
      try {
        const acct = await db.account.create({ data: { name, organizationId: orgId, ownerId: actorId } })
        accountsByLowerName.set(lower, { id: acct.id, name })
        accountsCreated++
        notices.push({ row: 0, reason: `Company "${name.slice(0, 60)}" was not in Accounts — created automatically so all its contacts and listings stay grouped` })
      } catch {
        notices.push({ row: 0, reason: `Could not auto-create account "${name.slice(0, 60)}" — rows saved without account link` })
      }
    }
    for (const v of valid) {
      const name = v.rec.__pendingAccountName
      if (typeof name === 'string' && name.trim()) {
        const acct = accountsByLowerName.get(name.trim().toLowerCase())
        if (acct) v.rec.accountId = acct.id
        delete v.rec.__pendingAccountName
      }
    }
  }

  const toCreate: Record<string, unknown>[] = []
  const updates: { id: string; data: Record<string, unknown> }[] = []
  // Listing-history rows to persist after the contacts exist. Entries for
  // already-known contacts carry contactId; entries for contacts created by
  // THIS import carry __pendingIndex (= index in toCreate) which is resolved
  // to the real contact id right after the create.
  const listingCreates: (Record<string, unknown> & { __pendingIndex?: number })[] = []
  // All listing rows queued per toCreate index — a contact created in this
  // file can receive SEVERAL listings (one per extra same-email row).
  const listingByIndex = new Map<number, Record<string, unknown>[]>()
  // Snapshot refresh for contacts created by this import that receive EXTRA
  // listings from later rows in the same file (mirror the latest listing).
  const snapshotByIndex = new Map<number, Record<string, unknown>>()
  // Refresh entries for listings that ALREADY exist (updateExisting mode).
  const listingRefreshes: { id: string; data: Record<string, unknown> }[] = []
  let listingsAdded = 0

  /** Listing-history payload extracted from a validated contact row. */
  const listingRowFrom = (rec: Record<string, unknown>, contactId: string | null) => ({
    organizationId: orgId,
    ...(contactId ? { contactId } : {}),
    accountId: (rec.accountId as string | undefined) ?? null,
    url: (rec.listingUrl as string | undefined) ?? null,
    title: (rec.listingTitle as string | undefined) ?? null,
    subtype: (rec.listingSubtype as string | undefined) ?? null,
    category: (rec.listingCategory as string | undefined) ?? null,
    recruiterTag: (rec.recruiterTag as string | undefined) ?? null,
    premiumStatus: (rec.premiumStatus as string | undefined) ?? null,
    totalApplications: (rec.totalApplications as number | undefined) ?? null,
    reasonableFitPct: (rec.reasonableFitPct as number | undefined) ?? null,
    reasonableScoreUsers: (rec.reasonableScoreUsers as number | undefined) ?? null,
    visibility: (rec.visibility as string | undefined) ?? null,
    hiringStatus: (rec.hiringStatus as string | undefined) ?? null,
    relevantApplications: (rec.relevantApplications as number | undefined) ?? null,
    hiredCount: (rec.hiredCount as number | undefined) ?? null,
    dateApproved: (rec.dateApproved as Date | undefined) ?? null,
    source: 'import',
  })

  const pendingIndex = new Map<string, number>() // contact identity → index in toCreate
  for (const v of valid) {
    const existing = existingMap.get(v.identity)
    if (existing) {
      if (moduleName === 'contact' && typeof v.rec.listingUrl === 'string' && v.rec.listingUrl) {
        // Same recruiter, this listing link. A link the contact never had
        // ADDS a listing-history entry (2nd, 3rd… listing over time); a link
        // already in the history is refreshed (update mode) or skipped.
        const urlLower = (v.rec.listingUrl as string).toLowerCase()
        const knownListingId = listingsByUrl.get(existing.id)?.get(urlLower) ?? null
        if (knownListingId && !updateExisting) {
          skipped++
          notices.push({ row: v.rowNum, reason: `Listing link already imported for ${v.lookupName || 'this contact'} — kept the existing entry` })
          continue
        }
        const data = buildContactUpdateData(v.rec)
        if (!existing.accountId && typeof v.rec.accountId === 'string') data.accountId = v.rec.accountId
        if (Object.keys(data).length > 0) updates.push({ id: existing.id, data })
        if (knownListingId) {
          // Refresh: only non-empty values touch the stored listing (same
          // policy as the contact snapshot update) + stamp lastImportedAt.
          const refresh: Record<string, unknown> = { lastImportedAt: new Date() }
          for (const [k, val] of Object.entries(listingRowFrom(v.rec, null))) {
            if (k === 'organizationId' || k === 'contactId' || k === 'source') continue
            if (val !== null && val !== undefined && val !== '') refresh[k] = val
          }
          listingRefreshes.push({ id: knownListingId, data: refresh })
        } else {
          listingCreates.push(listingRowFrom(v.rec, existing.id))
          if (!listingsByUrl.has(existing.id)) listingsByUrl.set(existing.id, new Map())
          listingsByUrl.get(existing.id)!.set(urlLower, 'pending')
          const n = listingsByUrl.get(existing.id)!.size
          listingsAdded++
          notices.push({ row: v.rowNum, reason: `Listing #${n} added for ${v.lookupName || 'this contact'} — same company, new link` })
        }
      } else if (updateExisting) {
        // Contacts: only Listing Intelligence fields (+ title) may overwrite
        // an existing record; other modules keep the previous full-record update.
        const data = moduleName === 'contact' ? buildContactUpdateData(v.rec) : v.rec
        if (moduleName === 'contact' && !existing.accountId && typeof v.rec.accountId === 'string') data.accountId = v.rec.accountId
        if (Object.keys(data).length > 0) {
          updates.push({ id: existing.id, data })
        } else {
          skipped++ // matched, but nothing allowed to change
          notices.push({
            row: v.rowNum,
            reason: moduleName === 'contact'
              ? 'Matched contact — nothing new to update'
              : 'Matched existing record — nothing new to update',
          })
        }
      } else {
        skipped++
        const noun = v.identity.includes('@') ? 'email' : 'name'
        notices.push({ row: v.rowNum, reason: `Duplicate ${noun} — existing ${moduleName} kept (update mode off)` })
      }
    } else if (moduleName === 'contact' && pendingIndex.has(v.identity)) {
      // A contact created EARLIER IN THIS FILE (same email) — this row is
      // another listing for it, not a new contact.
      const idx = pendingIndex.get(v.identity)!
      if (typeof v.rec.listingUrl === 'string' && v.rec.listingUrl) {
        const row = listingRowFrom(v.rec, null)
        const list = listingByIndex.get(idx)
        if (list) list.push(row); else listingByIndex.set(idx, [row])
        listingCreates.push(row)
        const snap = buildContactUpdateData(v.rec)
        if (Object.keys(snap).length > 0) snapshotByIndex.set(idx, snap)
        listingsAdded++
        notices.push({ row: v.rowNum, reason: `Listing added for ${v.lookupName || 'this contact'} — same recruiter, new link` })
      } else {
        skipped++
        notices.push({ row: v.rowNum, reason: `Duplicate ${v.identity.includes('@') ? 'email' : 'name'} inside file — first occurrence kept` })
      }
    } else {
      const idx = toCreate.length
      if (moduleName === 'contact' && typeof v.rec.listingUrl === 'string' && v.rec.listingUrl) {
        const row = listingRowFrom(v.rec, null)
        listingByIndex.set(idx, [row])
        listingCreates.push(row)
      }
      if (moduleName === 'contact') pendingIndex.set(v.identity, idx)
      toCreate.push(v.rec)
    }
  }

  // --- Bulk insert in chunks (fall back to per-row on chunk failure) ---
  const delegate = db[moduleName as 'lead' | 'contact' | 'account' | 'deal'] as any
  let created = 0
  const CHUNK = 500
  if (moduleName === 'contact') {
    // Contacts: route every NEW record through the assignment engine first —
    // assignment rules may match on the incoming listing fields. The actor
    // user is only the fallback when no rule matched. Lead/account/deal
    // imports keep the plain actor owner (no engine).
    // Prefetch: when the org has no active contact rules we skip the
    // per-row engine entirely (it would otherwise cost one query per row).
    const contactRuleCount = await db.assignmentRule.count({
      where: { organizationId: orgId, targetModel: 'contact', isActive: true },
    })
    for (let i = 0; i < toCreate.length; i++) {
      const rec = toCreate[i]
      let ownerId = actorId
      let ruleId: string | null = null
      if (contactRuleCount > 0) {
        try {
          const outcome = await applyAssignmentRules({
            organizationId: orgId,
            model: 'contact',
            record: rec,
            fallbackOwnerId: actorId,
          })
          if (outcome.ownerId) {
            ownerId = outcome.ownerId
            ruleId = outcome.ruleId
          }
        } catch { /* engine errors degrade to the actor fallback */ }
      }
      try {
        const row = await delegate.create({ data: { ...rec, organizationId: orgId, ownerId } })
        created++
        // Resolve this import's own pending listings + latest-listing snapshot
        const lis = listingByIndex.get(i)
        if (lis && row?.id) for (const l of lis) { l.contactId = row.id; delete l.__pendingIndex }
        const snap = snapshotByIndex.get(i)
        if (snap && row?.id && Object.keys(snap).length > 0) updates.push({ id: row.id, data: snap })
        await recordAssignment({
          organizationId: orgId,
          ruleId,
          recordModule: 'contact',
          recordId: row.id,
          assignedToId: ownerId,
        })
      } catch (e) {
        errors.push({ row: 0, reason: `Insert failed: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}` })
      }
    }
  } else {
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      const chunk = toCreate.slice(i, i + CHUNK).map((rec) => ({
        ...rec,
        organizationId: orgId,
        ownerId: actorId,
        ...(moduleName === 'lead' ? { createdById: actorId, lastActivity: new Date() } : {}),
      }))
      try {
        const res = await delegate.createMany({ data: chunk })
        created += res.count
      } catch {
        for (const rec of chunk) {
          try { await delegate.create({ data: rec }); created++ } catch (e) {
            errors.push({ row: 0, reason: `Insert failed: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}` })
          }
        }
      }
    }
  }

  // --- Listing history: batch insert (fall back to per-row on failure) ---
  const persistableListings = listingCreates.filter((l) => typeof l.contactId === 'string')
  for (let i = 0; i < persistableListings.length; i += CHUNK) {
    const chunk = persistableListings.slice(i, i + CHUNK).map((l) => { const { __pendingIndex: _drop, ...rest } = l; return rest })
    try {
      // All persistable entries carry organizationId + contactId (filtered
      // above) — the loose Record type just needs the Prisma assertion.
      await db.contactListing.createMany({ data: chunk as unknown as Prisma.ContactListingCreateManyInput[] })
    } catch {
      for (const l of chunk) {
        try { await db.contactListing.create({ data: l as unknown as Prisma.ContactListingUncheckedCreateInput }) } catch (e) {
          errors.push({ row: 0, reason: `Listing history insert failed: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}` })
        }
      }
    }
  }

  // --- Updates (per-row, org-scoped via updateMany) ---
  let updatedCount = 0
  for (const u of updates) {
    try {
      await delegate.updateMany({ where: { id: u.id, organizationId: orgId }, data: u.data })
      updatedCount++
    } catch {
      errors.push({ row: 0, reason: `Update failed for record ${u.id.slice(-8)}` })
    }
  }
  // Listing-history refreshes (updateExisting re-imports of a known link)
  for (const u of listingRefreshes) {
    const data = { ...u.data }
    delete data.contactId; delete data.organizationId
    try {
      await db.contactListing.updateMany({ where: { id: u.id, organizationId: orgId }, data })
      updatedCount++
    } catch {
      errors.push({ row: 0, reason: `Listing history update failed for ${u.id.slice(-8)}` })
    }
  }

  return {
    created,
    updated: updatedCount,
    skipped,
    failed: errors.length,
    listingsAdded,
    accountsCreated,
    errors: [...errors, ...notices].slice(0, 200),
  }
}
