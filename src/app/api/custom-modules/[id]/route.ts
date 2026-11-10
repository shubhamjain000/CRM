import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'

export const dynamic = 'force-dynamic'

/**
 * Module Builder API — per-module reads and a single POST action dispatch.
 *
 * GET  /api/custom-modules/:id
 *      → { module, fields, sections, views, relations }
 *      ?records=true additionally includes `records` (latest 200).
 *      `sections` is the migration-tolerant sectionsConfig (missing/`{}`
 *      synthesizes 'General' from fields' `section` values); `views` is the
 *      parsed viewsConfig (`[]` → caller falls back to 'All records').
 *
 * POST /api/custom-modules/:id   (JSON body; `action` picks the operation)
 *      add_field      {label, apiName?, fieldType?, isRequired?, isUnique?, isReadOnly?,
 *                      defaultValue?, helpText?, section?, fieldOptions?, dependency?}
 *      update_field   {fieldId, ...same props (all optional), fieldOptions merged}
 *      delete_field   {fieldId}
 *      reorder_fields {fields: [{id, section, displayOrder}]}
 *      update_sections{sections: [{name, columns: 1|2, collapsible}]}
 *      update_views   {views: [{name, filters: {apiName: value}}]}
 *      update_settings{name?, pluralName?, icon?, color?, isActive?,
 *                      recordNameField?, recordNameFormat?  // "auto:PREFIX" | null
 *                      }
 *      create_record  {recordData}  — legacy body without `action` also works
 *      update_record  {recordId, recordData}
 *      delete_record  {recordId}
 *      link_related   {recordId, relationId, childRecordId}
 *      unlink_related {recordId, relationId, childRecordId}
 *      get_related    {recordId, relationId} → {relation, childModule, records}
 *
 * recordNameFormat: "auto:PREFIX" enables PREFIX-0001 style names generated
 * server-side on record create (max existing + 1); null/"field" resolves the
 * name from data[recordNameField].
 *
 * Record uniqueness is enforced server-side by scanning the module's records
 * (org-scoped, capped at 10k) — SQLite JSON lives in a blob, not columns.
 */

type Json = Record<string, unknown>

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback
  try { const p = JSON.parse(raw); return (p === null || p === undefined ? fallback : p) as T } catch { return fallback }
}

function asStr(v: unknown): string { return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v) }
function asBool(v: unknown): boolean | undefined { return typeof v === 'boolean' ? v : undefined }
function asInt(v: unknown): number | undefined { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? Math.trunc(n) : undefined }

function sectionList(raw: string | null | undefined, fields: { section: string | null; displayOrder: number }[]) {
  const cfg = parseJson<{ sections?: unknown }>(raw ?? '{}', {})
  if (Array.isArray(cfg.sections) && cfg.sections.length > 0) {
    const seen = new Set<string>()
    const out: { name: string; columns: number; collapsible: boolean }[] = []
    for (const s of cfg.sections) {
      if (!s || typeof s !== 'object') continue
      const name = asStr((s as Json).name).trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push({ name, columns: Number((s as Json).columns) === 1 ? 1 : 2, collapsible: Boolean((s as Json).collapsible) })
    }
    if (out.length > 0) return out
  }
  const names: string[] = []
  for (const f of [...fields].sort((a, b) => a.displayOrder - b.displayOrder)) {
    const n = (f.section ?? '').trim() || 'General'
    if (!names.includes(n)) names.push(n)
  }
  if (names.length === 0) names.push('General')
  return names.map((n) => ({ name: n, columns: 2, collapsible: false }))
}

function viewList(raw: string | null | undefined) {
  const arr = parseJson<unknown[]>(raw ?? '[]', [])
  if (!Array.isArray(arr)) return []
  const out: { name: string; filters: Record<string, string> }[] = []
  for (const v of arr) {
    if (!v || typeof v !== 'object') continue
    const name = asStr((v as Json).name).trim()
    if (!name) continue
    const filters: Record<string, string> = {}
    const rf = (v as Json).filters
    if (rf && typeof rf === 'object') for (const [k, val] of Object.entries(rf as Json)) filters[k] = asStr(val)
    out.push({ name, filters })
  }
  return out
}

const err = (msg: string, status = 400, extra?: Json) => NextResponse.json({ error: msg, ...(extra ?? {}) }, { status })

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return err('Unauthorized', 401)
    const tenant = await getTenant(session.userId)
    if (!tenant) return err('No organization', 403)
    const orgId = tenant.organization.id
    const { id } = await params

    const mod = await db.customModule.findFirst({ where: { id, organizationId: orgId } })
    if (!mod) return err('Module not found', 404)

    const [fields, relations] = await Promise.all([
      db.customModuleField.findMany({ where: { moduleId: id, organizationId: orgId }, orderBy: { displayOrder: 'asc' } }),
      db.customModuleRelation.findMany({
        where: { organizationId: orgId, OR: [{ parentModuleId: id }, { childModuleId: id }] },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const payload: Json = {
      module: mod,
      fields,
      sections: sectionList(mod.sectionsConfig, fields),
      views: viewList(mod.viewsConfig),
      relations,
    }
    if (new URL(req.url).searchParams.get('records') === 'true') {
      payload.records = await db.customModuleRecord.findMany({
        where: { moduleId: id, organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
    }
    return NextResponse.json(payload)
  } catch (e) { return err(e instanceof Error ? e.message : 'Server error', 500) }
}

// ---------------------------------------------------------------------------
// POST — action dispatch
// ---------------------------------------------------------------------------

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return err('Unauthorized', 401)
    const tenant = await getTenant(session.userId)
    if (!tenant) return err('No organization', 403)
    const orgId = tenant.organization.id
    const { id } = await params

    const mod = await db.customModule.findFirst({ where: { id, organizationId: orgId } })
    if (!mod) return err('Module not found', 404)

    const body = await req.json().catch(() => null) as Json | null
    if (!body || typeof body !== 'object') return err('Invalid body')
    const action = typeof body.action === 'string' ? body.action : ''

    switch (action) {
      case 'add_field': return addFieldAction(mod, orgId, session.userId, body)
      case 'update_field': return updateFieldAction(mod, orgId, session.userId, body)
      case 'delete_field': return deleteFieldAction(mod, orgId, session.userId, body)
      case 'reorder_fields': return reorderFieldsAction(mod, orgId, session.userId, body)
      case 'update_sections': return updateSectionsAction(mod, orgId, session.userId, body)
      case 'update_views': return updateViewsAction(mod, orgId, session.userId, body)
      case 'update_settings': return updateSettingsAction(mod, orgId, session.userId, body)
      case 'create_record': return createRecordAction(mod, orgId, session.userId, body)
      case 'update_record': return updateRecordAction(mod, orgId, session.userId, body)
      case 'delete_record': return deleteRecordAction(mod, orgId, session.userId, body)
      case 'link_related': return linkRelatedAction(mod, orgId, session.userId, body, true)
      case 'unlink_related': return linkRelatedAction(mod, orgId, session.userId, body, false)
      case 'get_related': return getRelatedAction(mod, orgId, body)
      default: break
    }

    // ---- legacy shapes (no `action`), preserved for existing clients ----
    if (body.recordData !== undefined && typeof body.recordData === 'object' && body.recordData !== null) {
      return createRecordAction(mod, orgId, session.userId, { recordData: body.recordData })
    }
    if (typeof body.label === 'string' && body.label) {
      return addFieldAction(mod, orgId, session.userId, body)
    }
    return err('Invalid body')
  } catch (e) { return err(e instanceof Error ? e.message : 'Server error', 500) }
}

interface ModRow {
  id: string
  organizationId: string
  name: string
  pluralName: string
  slug: string
  icon: string
  color: string
  recordNameField: string
  isActive: boolean
  isSystem: boolean
  sectionsConfig: string
  viewsConfig: string
  recordNameFormat: string | null
  createdAt: Date
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// Field actions
// ---------------------------------------------------------------------------

async function addFieldAction(mod: ModRow, orgId: string, actorId: string, body: Json) {
  const label = asStr(body.label).trim()
  if (!label) return err('Missing label')
  const apiName = (asStr(body.apiName).trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `field_${Date.now()}`)
  const dup = await db.customModuleField.findFirst({ where: { moduleId: mod.id, apiName }, select: { id: true } })
  if (dup) return err(`Field API name "${apiName}" already exists in this module`, 409)
  const fields = await db.customModuleField.findMany({ where: { moduleId: mod.id, organizationId: orgId }, select: { displayOrder: true, section: true } })
  const lastOrder = fields.reduce((m, f) => Math.max(m, f.displayOrder), -1)
  const sections = sectionList(mod.sectionsConfig, fields)
  const dep = body.dependency && typeof body.dependency === 'object' ? JSON.stringify(body.dependency) : null
  const field = await db.customModuleField.create({
    data: {
      organizationId: orgId,
      moduleId: mod.id,
      label,
      apiName,
      fieldType: asStr(body.fieldType).trim() || 'text',
      fieldOptions: JSON.stringify(body.fieldOptions && typeof body.fieldOptions === 'object' ? body.fieldOptions : {}),
      defaultValue: body.defaultValue === undefined || body.defaultValue === null || body.defaultValue === '' ? null : asStr(body.defaultValue),
      isRequired: asBool(body.isRequired) ?? false,
      isUnique: asBool(body.isUnique) ?? false,
      isReadOnly: asBool(body.isReadOnly) ?? false,
      helpText: asStr(body.helpText).trim() || null,
      section: asStr(body.section).trim() || sections[0]?.name || 'General',
      dependency: dep,
      displayOrder: lastOrder + 1,
    },
  })
  await audit({ organizationId: orgId, actorId, action: 'custom_module_field.create', targetType: 'custom_module_field', targetId: field.id })
  return NextResponse.json({ id: field.id }, { status: 201 })
}

async function updateFieldAction(mod: ModRow, orgId: string, actorId: string, body: Json) {
  const fieldId = asStr(body.fieldId)
  if (!fieldId) return err('Missing fieldId')
  const field = await db.customModuleField.findFirst({ where: { id: fieldId, moduleId: mod.id, organizationId: orgId } })
  if (!field) return err('Field not found', 404)

  const data: {
    label?: string; apiName?: string; fieldType?: string; fieldOptions?: string
    defaultValue?: string | null; isRequired?: boolean; isUnique?: boolean; isReadOnly?: boolean; isSearchable?: boolean
    displayOrder?: number; section?: string | null; helpText?: string | null; dependency?: string | null
  } = {}

  if (typeof body.label === 'string' && body.label.trim()) data.label = body.label.trim()
  if (typeof body.apiName === 'string' && body.apiName.trim() && body.apiName.trim() !== field.apiName) {
    const next = body.apiName.trim()
    const dup = await db.customModuleField.findFirst({ where: { moduleId: mod.id, apiName: next, id: { not: field.id } }, select: { id: true } })
    if (dup) return err(`Field API name "${next}" already exists in this module`, 409)
    data.apiName = next
  }
  if (typeof body.fieldType === 'string' && body.fieldType.trim()) data.fieldType = body.fieldType.trim()
  if (body.fieldOptions !== undefined) {
    const incoming = body.fieldOptions && typeof body.fieldOptions === 'object' ? body.fieldOptions as Json : {}
    const merged = { ...parseJson<Json>(field.fieldOptions, {}), ...incoming }
    data.fieldOptions = JSON.stringify(merged)
  }
  if (body.defaultValue !== undefined) data.defaultValue = body.defaultValue === null || body.defaultValue === '' ? null : asStr(body.defaultValue)
  const req = asBool(body.isRequired); if (req !== undefined) data.isRequired = req
  const uniq = asBool(body.isUnique); if (uniq !== undefined) data.isUnique = uniq
  const ro = asBool(body.isReadOnly); if (ro !== undefined) data.isReadOnly = ro
  const srch = asBool(body.isSearchable); if (srch !== undefined) data.isSearchable = srch
  const order = asInt(body.displayOrder); if (order !== undefined) data.displayOrder = order
  if (body.section !== undefined) data.section = asStr(body.section).trim() || null
  if (body.helpText !== undefined) data.helpText = asStr(body.helpText).trim() || null
  if (body.dependency !== undefined) {
    data.dependency = body.dependency && typeof body.dependency === 'object' && asStr((body.dependency as Json).field) ? JSON.stringify(body.dependency) : null
  }

  const updated = await db.customModuleField.update({ where: { id: field.id }, data })
  await audit({ organizationId: orgId, actorId, action: 'custom_module_field.update', targetType: 'custom_module_field', targetId: field.id })
  return NextResponse.json({ id: updated.id })
}

async function deleteFieldAction(mod: ModRow, orgId: string, actorId: string, body: Json) {
  const fieldId = asStr(body.fieldId)
  if (!fieldId) return err('Missing fieldId')
  const res = await db.customModuleField.deleteMany({ where: { id: fieldId, moduleId: mod.id, organizationId: orgId } })
  if (res.count === 0) return err('Field not found', 404)
  await audit({ organizationId: orgId, actorId, action: 'custom_module_field.delete', targetType: 'custom_module_field', targetId: fieldId })
  return NextResponse.json({ ok: true })
}

async function reorderFieldsAction(mod: ModRow, orgId: string, actorId: string, body: Json) {
  const list = Array.isArray(body.fields) ? body.fields : null
  if (!list) return err('Missing fields array')
  let n = 0
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const fid = asStr((item as Json).id)
    if (!fid) continue
    const section = asStr((item as Json).section).trim() || null
    const displayOrder = asInt((item as Json).displayOrder) ?? n
    await db.customModuleField.updateMany({ where: { id: fid, moduleId: mod.id, organizationId: orgId }, data: { section, displayOrder } })
    n += 1
  }
  await audit({ organizationId: orgId, actorId, action: 'custom_module_fields.reorder', targetType: 'custom_module', targetId: mod.id })
  return NextResponse.json({ ok: true, updated: n })
}

async function updateSectionsAction(mod: ModRow, orgId: string, actorId: string, body: Json) {
  const list = Array.isArray(body.sections) ? body.sections : null
  if (!list || list.length === 0) return err('At least one section is required')
  const seen = new Set<string>()
  const sections: { name: string; columns: number; collapsible: boolean }[] = []
  for (const s of list) {
    if (!s || typeof s !== 'object') return err('Invalid section')
    const name = asStr((s as Json).name).trim()
    if (!name) return err('Section name is required')
    if (seen.has(name)) return err(`Duplicate section name "${name}"`)
    seen.add(name)
    sections.push({ name, columns: Number((s as Json).columns) === 1 ? 1 : 2, collapsible: Boolean((s as Json).collapsible) })
  }
  const updated = await db.customModule.update({ where: { id: mod.id }, data: { sectionsConfig: JSON.stringify({ sections }) } })
  await audit({ organizationId: orgId, actorId, action: 'custom_module.update_sections', targetType: 'custom_module', targetId: mod.id })
  return NextResponse.json({ sections: sectionList(updated.sectionsConfig, []) })
}

async function updateViewsAction(mod: ModRow, orgId: string, actorId: string, body: Json) {
  const list = Array.isArray(body.views) ? body.views : null
  if (!list) return err('Missing views array')
  const views: { name: string; filters: Record<string, string> }[] = []
  for (const v of list) {
    if (!v || typeof v !== 'object') return err('Invalid view')
    const name = asStr((v as Json).name).trim()
    if (!name) return err('View name is required')
    const filters: Record<string, string> = {}
    const rf = (v as Json).filters
    if (rf && typeof rf === 'object') for (const [k, val] of Object.entries(rf as Json)) filters[k] = asStr(val)
    views.push({ name, filters })
  }
  const updated = await db.customModule.update({ where: { id: mod.id }, data: { viewsConfig: JSON.stringify(views) } })
  await audit({ organizationId: orgId, actorId, action: 'custom_module.update_views', targetType: 'custom_module', targetId: mod.id })
  return NextResponse.json({ views: viewList(updated.viewsConfig) })
}

async function updateSettingsAction(mod: ModRow, orgId: string, actorId: string, body: Json) {
  const data: {
    name?: string; pluralName?: string; icon?: string; color?: string
    isActive?: boolean; recordNameField?: string; recordNameFormat?: string | null
  } = {}
  if (typeof body.name === 'string') {
    if (!body.name.trim()) return err('Module name cannot be empty')
    data.name = body.name.trim()
  }
  if (typeof body.pluralName === 'string') {
    if (!body.pluralName.trim()) return err('Plural label cannot be empty')
    data.pluralName = body.pluralName.trim()
  }
  if (typeof body.icon === 'string' && body.icon.trim()) data.icon = body.icon.trim()
  if (typeof body.color === 'string' && body.color.trim()) data.color = body.color.trim()
  const active = asBool(body.isActive); if (active !== undefined) data.isActive = active
  if (typeof body.recordNameField === 'string' && body.recordNameField.trim()) data.recordNameField = body.recordNameField.trim()
  if (body.recordNameFormat !== undefined) {
    if (body.recordNameFormat === null) data.recordNameFormat = null
    else if (typeof body.recordNameFormat === 'string') data.recordNameFormat = body.recordNameFormat.trim() || null
  }
  const updated = await db.customModule.update({ where: { id: mod.id }, data })
  await audit({ organizationId: orgId, actorId, action: 'custom_module.update_settings', targetType: 'custom_module', targetId: mod.id })
  return NextResponse.json({ module: { id: updated.id, isActive: updated.isActive, recordNameFormat: updated.recordNameFormat } })
}

// ---------------------------------------------------------------------------
// Record actions
// ---------------------------------------------------------------------------

function recordDataOf(raw: string): Json { return parseJson<Json>(raw, {}) }

/** First unique field whose value collides with an existing record (org-scoped scan, ≤10k). */
function findDuplicate(rows: { id: string; data: string }[], fields: { apiName: string; label: string; isUnique: boolean }[], data: Json, excludeRecordId?: string) {
  for (const f of fields) {
    if (!f.isUnique) continue
    const v = data[f.apiName]
    if (v === undefined || v === null || String(v) === '') continue
    const s = String(v)
    const dup = rows.some((r) => r.id !== excludeRecordId && String(recordDataOf(r.data)[f.apiName] ?? '') === s)
    if (dup) return f
  }
  return null
}

/**
 * Mirrors the client's fieldVisible (module-builder.tsx): `dependency` is JSON
 * `{field, value}` — the dependent field is only shown (and only enforced)
 * when String(record[field]) === String(value). Missing/malformed dependency
 * JSON counts as visible (same as the client's tolerant parse).
 */
function dependencySatisfied(depRaw: string | null | undefined, data: Json): boolean {
  if (!depRaw) return true
  const d = parseJson<Json>(depRaw, {})
  if (!d.field) return true
  return String(data[String(d.field)] ?? '') === String(d.value ?? '')
}

/** First required field left empty (checkbox must be true; autonumber/formula exempt;
 *  required fields hidden by an unmatched dependency are exempt too — the form never shows them). */
function findMissing(fields: { apiName: string; label: string; isRequired: boolean; isReadOnly: boolean; fieldType: string; dependency?: string | null }[], data: Json) {
  for (const f of fields) {
    if (!f.isRequired || f.isReadOnly) continue
    if (f.fieldType === 'autonumber' || f.fieldType === 'formula') continue
    if (!dependencySatisfied(f.dependency, data)) continue // hidden dependent field — must not fail validation
    const v = data[f.apiName]
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (f.fieldType === 'checkbox' && v !== true)
    if (empty) return f
  }
  return null
}

async function createRecordAction(mod: ModRow, orgId: string, actorId: string, body: Json) {
  const incoming = body.recordData && typeof body.recordData === 'object' ? body.recordData as Json : null
  if (!incoming) return err('Missing recordData')
  const fields = await db.customModuleField.findMany({ where: { moduleId: mod.id, organizationId: orgId }, orderBy: { displayOrder: 'asc' } })
  const rows = await db.customModuleRecord.findMany({ where: { moduleId: mod.id, organizationId: orgId }, select: { id: true, data: true }, take: 10000 })

  const data: Json = { ...incoming }

  // Auto number fields — server-generated PREFIX#### (max existing + 1).
  for (const f of fields) {
    if (f.fieldType !== 'autonumber') continue
    const prefix = asStr(parseJson<Json>(f.fieldOptions, {}).prefix)
    let max = 0
    for (const r of rows) {
      const m = String(recordDataOf(r.data)[f.apiName] ?? '').match(/(\d+)\s*$/)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    data[f.apiName] = `${prefix}${String(max + 1).padStart(4, '0')}`
  }

  // Auto record name — recordNameFormat "auto:PREFIX" → "PREFIX-0001" (max existing + 1, collision safe).
  const fmt = mod.recordNameFormat ?? ''
  let displayName = ''
  if (fmt.startsWith('auto:')) {
    const prefix = fmt.slice(5).trim() || mod.slug
    const taken = new Set<string>()
    let max = 0
    for (const r of rows) {
      const name = String(recordDataOf(r.data).name ?? '')
      if (name) taken.add(name)
      const m = name.match(/(\d+)\s*$/)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    let n = max + 1
    displayName = `${prefix}-${String(n).padStart(4, '0')}`
    while (taken.has(displayName)) { n += 1; displayName = `${prefix}-${String(n).padStart(4, '0')}` }
    data.name = displayName
  }

  const missing = findMissing(fields, data)
  if (missing) return err(`${missing.label} is required`, 400, { field: missing.apiName })
  const dupField = findDuplicate(rows, fields, data)
  if (dupField) return err(`${dupField.label} must be unique — a record with this value already exists`, 409, { field: dupField.apiName })

  const record = await db.customModuleRecord.create({ data: { organizationId: orgId, moduleId: mod.id, data: JSON.stringify(data), createdById: actorId } })
  await audit({ organizationId: orgId, actorId, action: 'custom_module_record.create', targetType: 'custom_module_record', targetId: record.id })
  return NextResponse.json({ id: record.id, name: displayName || undefined }, { status: 201 })
}

async function updateRecordAction(mod: ModRow, orgId: string, actorId: string, body: Json) {
  const recordId = asStr(body.recordId)
  const incoming = body.recordData && typeof body.recordData === 'object' ? body.recordData as Json : null
  if (!recordId) return err('Missing recordId')
  if (!incoming) return err('Missing recordData')
  const record = await db.customModuleRecord.findFirst({ where: { id: recordId, moduleId: mod.id, organizationId: orgId } })
  if (!record) return err('Record not found', 404)

  const fields = await db.customModuleField.findMany({ where: { moduleId: mod.id, organizationId: orgId }, orderBy: { displayOrder: 'asc' } })
  const rows = await db.customModuleRecord.findMany({ where: { moduleId: mod.id, organizationId: orgId }, select: { id: true, data: true }, take: 10000 })
  const merged: Json = { ...recordDataOf(record.data), ...incoming }

  const missing = findMissing(fields, merged)
  if (missing) return err(`${missing.label} is required`, 400, { field: missing.apiName })
  const dupField = findDuplicate(rows, fields, merged, record.id)
  if (dupField) return err(`${dupField.label} must be unique — another record already has this value`, 409, { field: dupField.apiName })

  await db.customModuleRecord.update({ where: { id: record.id }, data: { data: JSON.stringify(merged), modifiedById: actorId } })
  await audit({ organizationId: orgId, actorId, action: 'custom_module_record.update', targetType: 'custom_module_record', targetId: record.id })
  return NextResponse.json({ id: record.id })
}

async function deleteRecordAction(mod: ModRow, orgId: string, actorId: string, body: Json) {
  const recordId = asStr(body.recordId)
  if (!recordId) return err('Missing recordId')
  const res = await db.customModuleRecord.deleteMany({ where: { id: recordId, moduleId: mod.id, organizationId: orgId } })
  if (res.count === 0) return err('Record not found', 404)
  await audit({ organizationId: orgId, actorId, action: 'custom_module_record.delete', targetType: 'custom_module_record', targetId: recordId })
  return NextResponse.json({ ok: true })
}

// ---------------------------------------------------------------------------
// Related list actions
// ---------------------------------------------------------------------------

async function linkRelatedAction(mod: ModRow, orgId: string, actorId: string, body: Json, isLink: boolean) {
  const recordId = asStr(body.recordId)
  const relationId = asStr(body.relationId)
  const childRecordId = asStr(body.childRecordId)
  if (!recordId || !relationId || !childRecordId) return err('Missing recordId, relationId or childRecordId')

  const rel = await db.customModuleRelation.findFirst({ where: { id: relationId, organizationId: orgId, parentModuleId: mod.id } })
  if (!rel) return err('Relation not found', 404)
  const parent = await db.customModuleRecord.findFirst({ where: { id: recordId, moduleId: mod.id, organizationId: orgId }, select: { id: true } })
  if (!parent) return err('Record not found', 404)
  const child = await db.customModuleRecord.findFirst({ where: { id: childRecordId, moduleId: rel.childModuleId, organizationId: orgId } })
  if (!child) return err('Child record not found', 404)

  const childData = recordDataOf(child.data)
  const key = rel.childFieldApiName
  if (rel.type === 'many_to_many') {
    const cur = childData[key]
    const arr = Array.isArray(cur) ? cur.map(String) : (cur === undefined || cur === null || cur === '' ? [] : [String(cur)])
    const next = isLink ? (arr.includes(recordId) ? arr : [...arr, recordId]) : arr.filter((x) => x !== recordId)
    childData[key] = next
  } else {
    if (isLink) childData[key] = recordId
    else delete childData[key] // 1:N unlink clears the lookup (spec: set to ''/remove key)
  }
  await db.customModuleRecord.update({ where: { id: child.id }, data: { data: JSON.stringify(childData) } })
  await audit({ organizationId: orgId, actorId, action: isLink ? 'custom_module_record.link_related' : 'custom_module_record.unlink_related', targetType: 'custom_module_record', targetId: child.id, metadata: { relationId, parentRecordId: recordId } })
  return NextResponse.json({ ok: true })
}

async function getRelatedAction(mod: ModRow, orgId: string, body: Json) {
  const recordId = asStr(body.recordId)
  const relationId = asStr(body.relationId)
  if (!recordId || !relationId) return err('Missing recordId or relationId')
  const rel = await db.customModuleRelation.findFirst({ where: { id: relationId, organizationId: orgId, parentModuleId: mod.id } })
  if (!rel) return err('Relation not found', 404)
  const childModule = await db.customModule.findFirst({ where: { id: rel.childModuleId, organizationId: orgId } })
  if (!childModule) return err('Child module not found', 404)
  const children = await db.customModuleRecord.findMany({ where: { moduleId: rel.childModuleId, organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 200 })
  const matched = children.filter((c) => {
    const d = recordDataOf(c.data)
    const cur = d[rel.childFieldApiName]
    if (rel.type === 'many_to_many') return Array.isArray(cur) && cur.map(String).includes(recordId)
    return String(cur ?? '') === recordId
  })
  return NextResponse.json({
    relation: rel,
    childModule: { id: childModule.id, name: childModule.name, pluralName: childModule.pluralName, recordNameField: childModule.recordNameField, recordNameFormat: childModule.recordNameFormat },
    records: matched,
  })
}
