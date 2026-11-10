import { db } from '@/lib/db'
import { MAX_IMPORT_ROWS, IMPORT_SPECS, processImportRows, type ImportOutcome } from '@/lib/crm/import-core'

/**
 * API auto-import connector — turns a connected HTTP endpoint into a living
 * CRM data feed. An `Integration` row with provider "custom_api" stores a
 * JSON config describing the endpoint, auth, target module, field mapping and
 * schedule. `syncApiImport` fetches the endpoint, maps rows through the SAME
 * import pipeline as the UI Import Wizard (validation, dedupe, account
 * resolution, assignment rules) and records the outcome in IntegrationLog.
 *
 * Scheduled runs are executed by the background job runner
 * (src/lib/jobs/runner.ts) every tick; manual runs come from
 * /api/integrations/[id]/sync.
 */

export const CUSTOM_API_PROVIDER = 'custom_api'

export interface ApiImportConfig {
  endpointUrl: string
  method?: 'GET' | 'POST'
  authType?: 'none' | 'bearer' | 'basic' | 'header'
  /** Bearer token — or the value used for `headerName` when authType is "header". */
  authToken?: string
  authUsername?: string
  authPassword?: string
  headerName?: string
  extraHeaders?: Record<string, string>
  targetModule: 'lead' | 'contact' | 'account' | 'deal'
  /** Dot path to the row array inside the JSON response, e.g. "data.items". Empty = response IS the array (auto-detected). */
  rowsPath?: string
  /** One mapping per line: remote_key=crmField. Empty = auto-map by name. */
  fieldMapping?: string
  /** Auto-import cadence in minutes (0 = off). Minimum 15. */
  scheduleMinutes?: number
  /** Update matched existing records instead of skipping them. */
  updateExisting?: boolean
  /** Records land owned by this user (set to the admin who configured the feed). */
  ownerId?: string
}

/** Secret-ish config keys redacted to "__SAVED__" whenever a config leaves the server. */
const SECRET_KEYS = ['authToken', 'authPassword'] as const
export const REDACTED = '__SAVED__'

export function parseConfig(raw: string | null | undefined): Partial<ApiImportConfig> {
  if (!raw) return {}
  try {
    const p = JSON.parse(raw)
    return typeof p === 'object' && p !== null ? p : {}
  } catch {
    return {}
  }
}

/** Mask secrets for API responses. */
export function redactConfig(config: Partial<ApiImportConfig>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config }
  for (const k of SECRET_KEYS) {
    if (typeof out[k] === 'string' && (out[k] as string).length > 0) out[k] = REDACTED
  }
  return out
}

/** Restore redacted placeholders with the previously stored secrets. */
export function mergeSavedSecrets(next: Partial<ApiImportConfig>, prev: Partial<ApiImportConfig>): Partial<ApiImportConfig> {
  const merged: Record<string, unknown> = { ...next }
  for (const k of SECRET_KEYS) {
    if ((merged as Record<string, unknown>)[k] === REDACTED) {
      ;(merged as Record<string, unknown>)[k] = (prev as Record<string, unknown>)[k] ?? ''
    }
  }
  return merged as Partial<ApiImportConfig>
}

export function buildAuthHeaders(cfg: Partial<ApiImportConfig>): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  switch (cfg.authType) {
    case 'bearer':
      if (cfg.authToken) headers.Authorization = `Bearer ${cfg.authToken}`
      break
    case 'basic': {
      const raw = `${cfg.authUsername ?? ''}:${cfg.authPassword ?? ''}`
      headers.Authorization = `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
      break
    }
    case 'header':
      if (cfg.headerName && cfg.authToken) headers[cfg.headerName] = cfg.authToken
      break
    default:
      break
  }
  if (cfg.extraHeaders && typeof cfg.extraHeaders === 'object') {
    for (const [k, v] of Object.entries(cfg.extraHeaders)) {
      if (k && typeof v === 'string') headers[k] = v
    }
  }
  return headers
}

const ROW_ARRAY_KEYS = ['data', 'rows', 'items', 'results', 'records', 'leads', 'contacts', 'accounts', 'deals']

/** Pull the row array out of an arbitrary JSON payload (dot path first, then well-known keys). */
export function extractRows(payload: unknown, rowsPath?: string): Record<string, unknown>[] {
  if (rowsPath) {
    let cur: unknown = payload
    for (const part of rowsPath.split('.').filter(Boolean)) {
      if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[part]
      } else {
        throw new Error(`rowsPath "${rowsPath}" not found in the response`)
      }
    }
    if (!Array.isArray(cur)) throw new Error(`rowsPath "${rowsPath}" does not point to an array`)
    return cur as Record<string, unknown>[]
  }
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    for (const k of ROW_ARRAY_KEYS) {
      if (Array.isArray(obj[k])) return obj[k] as Record<string, unknown>[]
    }
  }
  throw new Error('Could not find an array of rows in the response — set "Rows path"')
}

const camel = (s: string) => s.replace(/[_-]([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())

function parseMappingLines(lines: string | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of String(lines ?? '').split('\n')) {
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const from = line.slice(0, idx).trim()
    const to = line.slice(idx + 1).trim()
    if (from && to) map[from] = to
  }
  return map
}

/**
 * Map one remote row onto CRM field names.
 * 1. explicit mapping lines win,
 * 2. otherwise keys that (case/space/underscore-insensitively) equal a CRM
 *    field for the target module are kept under that field name,
 * 3. unknown keys are dropped (the import spec ignores them anyway).
 */
export function mapRow(row: Record<string, unknown>, module: string, mapping: Record<string, string>): Record<string, unknown> {
  const spec = IMPORT_SPECS[module] ?? {}
  const canon = (s: string) => camel(String(s)).toLowerCase().replace(/[^a-z0-9]/g, '')
  const specByCanon = new Map<string, string>()
  for (const f of Object.keys(spec)) specByCanon.set(canon(f), f)
  // Canonical aliases so "email_id", "emailId", "Email" all find a target.
  const extraAliases: Record<string, string> = {
    email: 'emails', emailid: 'emails', mail: 'emails',
    phone: 'phones', mobile: 'phones', mobilenumber: 'phones', phonenumber: 'phones',
    name: module === 'account' || module === 'deal' ? 'name' : 'firstName',
    account: 'accountName', accountname: 'accountName', companyname: 'accountName',
    firstname: 'firstName', lastname: 'lastName', fullname: 'fullName',
    title: spec.title !== undefined ? 'title' : 'listingTitle',
  }
  const out: Record<string, unknown> = {}
  for (const [rawKey, rawVal] of Object.entries(row)) {
    if (rawVal === null || rawVal === undefined || rawVal === '') continue
    const mapped = mapping[rawKey]
    if (mapped && (spec[mapped] !== undefined || ['fullName', 'accountName'].includes(mapped))) {
      out[mapped] = rawVal
      continue
    }
    const c = canon(rawKey)
    const target = specByCanon.get(c) ?? extraAliases[c]
    if (target) out[target] = rawVal
  }
  return out
}

async function fetchApiResponse(cfg: Partial<ApiImportConfig>): Promise<unknown> {
  const url = String(cfg.endpointUrl ?? '').trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('Endpoint URL must start with http:// or https://')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, {
      method: cfg.method === 'POST' ? 'POST' : 'GET',
      headers: buildAuthHeaders(cfg),
      body: cfg.method === 'POST' ? JSON.stringify({}) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Endpoint responded with HTTP ${res.status}`)
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('Response is not valid JSON (CSV/XML endpoints are not supported yet)')
    }
  } finally {
    clearTimeout(timer)
  }
}

export interface TestResult {
  ok: true
  rowCount: number
  sample: Record<string, unknown>[]
  unmappedSampleKeys: string[]
}

/** Fetch the endpoint and preview what a sync would import — no writes. */
export async function testApiImport(cfg: Partial<ApiImportConfig>): Promise<TestResult> {
  const moduleName = cfg.targetModule ?? 'lead'
  if (!IMPORT_SPECS[moduleName]) throw new Error('Pick a target module')
  const payload = await fetchApiResponse(cfg)
  const rawRows = extractRows(payload, cfg.rowsPath)
  const mapping = parseMappingLines(cfg.fieldMapping)
  const mappedSample = rawRows.slice(0, 3).map((r) => mapRow(r, moduleName, mapping))
  const specKeys = new Set(Object.keys(IMPORT_SPECS[moduleName]).concat(['fullName', 'accountName']))
  // Keys from the remote payload that did not land on any CRM field — a hint
  // that explicit mapping lines may be needed.
  const mappedTargets = new Set<string>()
  for (const r of mappedSample) for (const k of Object.keys(r)) mappedTargets.add(k)
  const rawKeys = [...new Set(rawRows.slice(0, 5).flatMap((r) => Object.keys(r)))]
  const unmappedSampleKeys = rawKeys.filter((k) => {
    const m = mapRow({ [k]: 'x' }, moduleName, mapping)
    const target = Object.keys(m)[0]
    return !target || !specKeys.has(target) || !mappedTargets.has(target)
  })
  return {
    ok: true,
    rowCount: rawRows.length,
    sample: mappedSample,
    unmappedSampleKeys,
  }
}

/** One full sync: fetch → map → import → bookkeeping (lastSyncedAt + log). */
export async function syncApiImport(integration: { id: string; organizationId: string; config: string | null }): Promise<ImportOutcome> {
  const cfg = parseConfig(integration.config) as ApiImportConfig
  const moduleName = cfg.targetModule ?? 'lead'
  if (!cfg.endpointUrl) throw new Error('This connection has no endpoint URL configured')
  if (!IMPORT_SPECS[moduleName]) throw new Error(`Unknown target module "${moduleName}"`)
  if (!cfg.ownerId) throw new Error('This connection has no owner configured — re-save it from Ecosystem → Integrations')

  try {
    const payload = await fetchApiResponse(cfg)
    const rawRows = extractRows(payload, cfg.rowsPath)
    if (rawRows.length === 0) {
      await db.integration.update({ where: { id: integration.id }, data: { lastSyncedAt: new Date() } })
      await db.integrationLog.create({
        data: { organizationId: integration.organizationId, integrationId: integration.id, event: 'sync', status: 'info', details: 'Endpoint returned 0 rows' },
      })
      return { created: 0, updated: 0, skipped: 0, failed: 0, listingsAdded: 0, accountsCreated: 0, errors: [] }
    }
    if (rawRows.length > MAX_IMPORT_ROWS) rawRows.length = MAX_IMPORT_ROWS
    const mapping = parseMappingLines(cfg.fieldMapping)
    const rows = rawRows.map((r) => mapRow(r, moduleName, mapping))
    const outcome = await processImportRows({
      orgId: integration.organizationId,
      actorId: cfg.ownerId,
      module: moduleName,
      rows,
      updateExisting: cfg.updateExisting === true,
    })
    await db.integration.update({ where: { id: integration.id }, data: { lastSyncedAt: new Date() } })
    const errSummary = outcome.errors.slice(0, 3).map((e) => `row ${e.row}: ${e.reason}`).join(' · ')
    await db.integrationLog.create({
      data: {
        organizationId: integration.organizationId,
        integrationId: integration.id,
        event: 'sync',
        status: outcome.failed > 0 ? 'warning' : 'success',
        details: `${moduleName}: ${outcome.created} created, ${outcome.updated} updated, ${outcome.skipped} skipped, ${outcome.failed} failed (${rawRows.length} rows fetched)${errSummary ? ` — ${errSummary}` : ''}`,
      },
    })
    return outcome
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Sync failed'
    await db.integrationLog.create({
      data: { organizationId: integration.organizationId, integrationId: integration.id, event: 'sync', status: 'error', details: message.slice(0, 500) },
    })
    throw e
  }
}

/** The background-job sweep: sync every due connected feed. */
export async function syncDueIntegrations(maxPerTick = 5): Promise<{ synced: number; failed: number }> {
  const integrations = await db.integration.findMany({
    where: { isConnected: true, provider: CUSTOM_API_PROVIDER },
    take: 50,
  })
  let synced = 0
  let failed = 0
  for (const integ of integrations) {
    if (synced + failed >= maxPerTick) break
    const cfg = parseConfig(integ.config)
    const mins = Number(cfg.scheduleMinutes ?? 0)
    if (!cfg.endpointUrl || !Number.isFinite(mins) || mins < 15) continue
    const last = integ.lastSyncedAt?.getTime() ?? 0
    if (Date.now() - last < mins * 60_000) continue
    try {
      await syncApiImport(integ)
      synced++
    } catch {
      failed++ // already logged to IntegrationLog by syncApiImport
    }
  }
  return { synced, failed }
}
