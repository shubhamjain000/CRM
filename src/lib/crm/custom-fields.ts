import { db } from '@/lib/db'
import { getTenant } from '@/lib/auth/tenant'
import { getSession } from '@/lib/auth/session'
import { audit } from '@/lib/auth/audit'

export const FIELD_TYPES = [
  'text', 'long_text', 'rich_text', 'number', 'currency', 'percent', 'decimal',
  'date', 'datetime', 'time', 'email', 'phone', 'url', 'picklist', 'multi_picklist',
  'checkbox', 'lookup', 'subform', 'formula', 'rollup_summary', 'file', 'image',
  'rating', 'address',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

export const CUSTOM_FIELD_MODULES = ['lead', 'contact', 'account', 'deal'] as const

type CustomFieldModule = (typeof CUSTOM_FIELD_MODULES)[number]

const API_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const MAX_LABEL_LENGTH = 120

export class CustomFieldNotFoundError extends Error {
  constructor() {
    super('Custom field not found')
    this.name = 'CustomFieldNotFoundError'
  }
}

export async function listCustomFields(module?: string) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  return db.customField.findMany({
    where: {
      organizationId: tenant.organization.id,
      ...(module ? { module } : {}),
      isActive: true,
    },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createCustomField(input: {
  module: string
  label: string
  apiName: string
  fieldType: string
  fieldOptions?: Record<string, unknown>
  validationRules?: Record<string, unknown>
  defaultValue?: string | null
}) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  if (!CUSTOM_FIELD_MODULES.includes(input.module as CustomFieldModule)) {
    throw new Error(`Invalid module: ${input.module}. Must be one of: ${CUSTOM_FIELD_MODULES.join(', ')}`)
  }

  const label = String(input.label ?? '').trim()
  if (!label || label.length > MAX_LABEL_LENGTH) {
    throw new Error(`Label must be between 1 and ${MAX_LABEL_LENGTH} characters`)
  }

  const apiName = String(input.apiName ?? '')
  if (!API_NAME_PATTERN.test(apiName)) {
    throw new Error('Invalid apiName: must be lowercase, start with a letter, max 64 chars (a-z, 0-9, _)')
  }

  if (!FIELD_TYPES.includes(input.fieldType as FieldType)) {
    throw new Error(`Invalid field type: ${input.fieldType}`)
  }

  const duplicate = await db.customField.findFirst({
    where: {
      organizationId: tenant.organization.id,
      module: input.module,
      apiName,
    },
    select: { id: true },
  })
  if (duplicate) {
    throw new Error(`A custom field with apiName "${apiName}" already exists for module ${input.module}`)
  }

  const field = await db.customField.create({
    data: {
      organizationId: tenant.organization.id,
      module: input.module,
      label,
      apiName,
      fieldType: input.fieldType,
      fieldOptions: JSON.stringify(input.fieldOptions ?? {}),
      validationRules: JSON.stringify(input.validationRules ?? {}),
      defaultValue: input.defaultValue ?? null,
    },
  })

  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: 'custom_field.create',
    targetType: 'custom_field',
    targetId: field.id,
    metadata: { module: input.module, apiName: input.apiName, fieldType: input.fieldType },
  })
  return field
}

/**
 * Update a custom field definition (label / options / rules / default value).
 * Org-scoped; throws CustomFieldNotFoundError when the field does not belong
 * to the caller's organization.
 */
export async function updateCustomField(
  id: string,
  patch: {
    label?: unknown
    fieldOptions?: unknown
    validationRules?: unknown
    defaultValue?: unknown
  },
) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  const existing = await db.customField.findFirst({
    where: { id, organizationId: tenant.organization.id, isActive: true },
  })
  if (!existing) throw new CustomFieldNotFoundError()

  const data: {
    label?: string
    fieldOptions?: string
    validationRules?: string
    defaultValue?: string | null
  } = {}

  if (patch.label !== undefined) {
    const label = String(patch.label).trim()
    if (!label || label.length > MAX_LABEL_LENGTH) {
      throw new Error(`Label must be between 1 and ${MAX_LABEL_LENGTH} characters`)
    }
    data.label = label
  }
  if (patch.fieldOptions !== undefined) {
    if (!patch.fieldOptions || typeof patch.fieldOptions !== 'object' || Array.isArray(patch.fieldOptions)) {
      throw new Error('fieldOptions must be an object')
    }
    data.fieldOptions = JSON.stringify(patch.fieldOptions as Record<string, unknown>)
  }
  if (patch.validationRules !== undefined) {
    if (!patch.validationRules || typeof patch.validationRules !== 'object' || Array.isArray(patch.validationRules)) {
      throw new Error('validationRules must be an object')
    }
    data.validationRules = JSON.stringify(patch.validationRules as Record<string, unknown>)
  }
  if (patch.defaultValue !== undefined) {
    data.defaultValue = patch.defaultValue === null ? null : String(patch.defaultValue)
  }

  let field = existing
  if (Object.keys(data).length > 0) {
    field = await db.customField.update({ where: { id }, data })
  }

  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: 'custom_field.update',
    targetType: 'custom_field',
    targetId: id,
    metadata: { module: existing.module, apiName: existing.apiName, keys: Object.keys(data) },
  })
  return field
}

/**
 * Soft-delete a custom field definition: deactivated (isActive=false) but
 * stored record values are kept for reporting/history. Org-scoped.
 */
export async function deleteCustomField(id: string) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  const existing = await db.customField.findFirst({
    where: { id, organizationId: tenant.organization.id, isActive: true },
  })
  if (!existing) throw new CustomFieldNotFoundError()

  const field = await db.customField.update({
    where: { id },
    data: { isActive: false },
  })

  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: 'custom_field.delete',
    targetType: 'custom_field',
    targetId: id,
    metadata: { module: existing.module, apiName: existing.apiName, soft: true },
  })
  return field
}

/**
 * Parse the picklist options array out of a CustomField.fieldOptions JSON blob.
 */
function parsePicklistOptions(fieldOptionsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(fieldOptionsJson || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const options = (parsed as Record<string, unknown>).options
      if (Array.isArray(options)) return options.map((o) => String(o))
    }
  } catch {
    // malformed options -> treated as no options
  }
  return []
}

/**
 * Coerce + validate a raw form value for a custom field, returning the JSON
 * string to store in CustomFieldValue.value. Throws a user-facing error when
 * the value does not match the field type / options.
 */
function coerceCustomValue(
  field: { label: string; fieldType: string; fieldOptions: string },
  value: unknown,
): string {
  const type = field.fieldType
  switch (type) {
    case 'text':
    case 'long_text':
    case 'rich_text':
    case 'email':
    case 'phone':
    case 'url':
    case 'time':
    case 'address':
      return JSON.stringify(String(value).slice(0, 10000))

    case 'number':
    case 'decimal':
    case 'percent':
    case 'currency': {
      const n = Number(value)
      if (Number.isNaN(n)) throw new Error(`Field ${field.label} must be a number`)
      return JSON.stringify(n)
    }

    case 'rating': {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        throw new Error(`Field ${field.label} must be an integer between 1 and 5`)
      }
      return JSON.stringify(n)
    }

    case 'checkbox':
      return JSON.stringify(Boolean(value))

    case 'date':
    case 'datetime': {
      const d = new Date(String(value))
      if (Number.isNaN(d.getTime())) throw new Error(`Field ${field.label} must be a valid date`)
      return JSON.stringify(d.toISOString())
    }

    case 'picklist': {
      const s = String(value)
      const options = parsePicklistOptions(field.fieldOptions)
      if (options.length > 0 && !options.includes(s)) {
        throw new Error(`Field ${field.label} must be one of: ${options.join(', ')}`)
      }
      return JSON.stringify(s)
    }

    case 'multi_picklist': {
      if (!Array.isArray(value)) throw new Error(`Field ${field.label} must be an array of values`)
      const options = parsePicklistOptions(field.fieldOptions)
      const items = value.map((v) => String(v))
      if (options.length > 0) {
        const invalid = items.filter((item) => !options.includes(item))
        if (invalid.length > 0) {
          throw new Error(`Field ${field.label} must contain only: ${options.join(', ')}`)
        }
      }
      return JSON.stringify(items)
    }

    default:
      throw new Error(`${type} fields are not supported in forms yet`)
  }
}

/**
 * Write custom field values for a record. Values are keyed by the field's
 * apiName; every key must match an active CustomField definition for the
 * module, otherwise an error is thrown BEFORE any value is written.
 * Value null stores JSON "null" (clears the value).
 */
export async function upsertCustomValues(
  module: string,
  recordId: string,
  custom: Record<string, unknown>,
) {
  const entries = Object.entries(custom ?? {})
  if (entries.length === 0) return

  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  const organizationId = tenant.organization.id

  const apiNames = entries.map(([apiName]) => apiName)
  const defs = await db.customField.findMany({
    where: {
      organizationId,
      module,
      isActive: true,
      apiName: { in: apiNames },
    },
  })
  const defMap = new Map(defs.map((d) => [d.apiName, d]))

  // Reject every unknown apiName before writing anything.
  for (const apiName of apiNames) {
    if (!defMap.has(apiName)) throw new Error(`Unknown custom field: ${apiName}`)
  }

  // Coerce + validate all values before writing anything.
  const writes: { fieldId: string; value: string }[] = []
  for (const [apiName, rawValue] of entries) {
    const def = defMap.get(apiName)!
    if (rawValue === null) {
      writes.push({ fieldId: def.id, value: 'null' }) // clears the value
      continue
    }
    writes.push({ fieldId: def.id, value: coerceCustomValue(def, rawValue) })
  }

  for (const w of writes) {
    await db.customFieldValue.upsert({
      where: { fieldId_recordId: { fieldId: w.fieldId, recordId } },
      update: { value: w.value },
      create: {
        organizationId,
        module,
        recordId,
        fieldId: w.fieldId,
        value: w.value,
      },
    })
  }

  await audit({
    organizationId,
    actorId: session.userId,
    action: 'custom_value.write',
    targetType: module,
    targetId: recordId,
    metadata: { apiNames },
  })
}

/**
 * Get all custom field values for a set of records (batch fetch).
 */
export async function getCustomValuesMap(module: string, recordIds: string[]) {
  if (recordIds.length === 0) return {}
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  const values = await db.customFieldValue.findMany({
    where: {
      organizationId: tenant.organization.id,
      module,
      recordId: { in: recordIds },
    },
    include: { field: { select: { apiName: true } } },
  })

  const map: Record<string, Record<string, unknown>> = {}
  for (const v of values) {
    if (!map[v.recordId]) map[v.recordId] = {}
    map[v.recordId][v.field.apiName] = JSON.parse(v.value || 'null')
  }
  return map
}
