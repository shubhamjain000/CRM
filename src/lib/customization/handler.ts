import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

// ---------------------------------------------------------------------------
// Custom Modules
// ---------------------------------------------------------------------------

export async function listModules() {
  const { tenant } = await ctx()
  return db.customModule.findMany({
    where: { organizationId: tenant.organization.id, isActive: true },
    include: { _count: { select: { fields: true, records: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createModule(data: { name: string; pluralName: string; icon?: string; color?: string }) {
  const { session, tenant } = await ctx()
  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const mod = await db.customModule.create({
    data: {
      organizationId: tenant.organization.id,
      name: data.name,
      pluralName: data.pluralName || data.name + 's',
      slug,
      icon: data.icon ?? 'Box',
      color: data.color ?? '#3b82f6',
    },
  })
  // Auto-create default "name" field
  await db.customModuleField.create({
    data: {
      organizationId: tenant.organization.id,
      moduleId: mod.id,
      label: 'Name',
      apiName: 'name',
      fieldType: 'text',
      isRequired: true,
      displayOrder: 0,
    },
  })
  await audit({ organizationId: tenant.organization.id, actorId: session.userId, action: 'custom_module.create', targetType: 'custom_module', targetId: mod.id })
  return mod
}

export async function addField(moduleId: string, data: { label: string; apiName: string; fieldType: string; isRequired?: boolean; fieldOptions?: Record<string, unknown> }) {
  const { session, tenant } = await ctx()
  // Verify the module belongs to this tenant (prevents cross-org field injection)
  const mod = await db.customModule.findFirst({
    where: { id: moduleId, organizationId: tenant.organization.id },
    select: { id: true },
  })
  if (!mod) throw new Error('Module not found')
  const lastOrder = await db.customModuleField.findFirst({ where: { moduleId }, orderBy: { displayOrder: 'desc' }, select: { displayOrder: true } })
  return db.customModuleField.create({
    data: {
      organizationId: tenant.organization.id,
      moduleId,
      label: data.label,
      apiName: data.apiName,
      fieldType: data.fieldType,
      isRequired: data.isRequired ?? false,
      fieldOptions: JSON.stringify(data.fieldOptions ?? {}),
      displayOrder: (lastOrder?.displayOrder ?? -1) + 1,
    },
  })
}

export async function listFields(moduleId: string) {
  const { tenant } = await ctx()
  return db.customModuleField.findMany({ where: { moduleId, organizationId: tenant.organization.id }, orderBy: { displayOrder: 'asc' } })
}

export async function listRecords(moduleId: string) {
  const { tenant } = await ctx()
  return db.customModuleRecord.findMany({ where: { moduleId, organizationId: tenant.organization.id }, orderBy: { createdAt: 'desc' }, take: 200 })
}

export async function createRecord(moduleId: string, data: Record<string, unknown>) {
  const { session, tenant } = await ctx()
  // Verify the module belongs to this tenant (prevents cross-org record
  // injection — without this, a caller could pass another tenant's moduleId
  // and stamp their own organizationId onto the row, polluting the other
  // tenant's module view).
  const mod = await db.customModule.findFirst({
    where: { id: moduleId, organizationId: tenant.organization.id },
    select: { id: true },
  })
  if (!mod) throw new Error('Module not found')
  const record = await db.customModuleRecord.create({
    data: {
      organizationId: tenant.organization.id,
      moduleId,
      data: JSON.stringify(data),
    },
  })
  await audit({ organizationId: tenant.organization.id, actorId: session.userId, action: 'custom_module_record.create', targetType: 'custom_module_record', targetId: record.id })
  return record
}

// ---------------------------------------------------------------------------
// Canvas Theme
// ---------------------------------------------------------------------------

export async function getCanvasTheme() {
  const { tenant } = await ctx()
  let theme = await db.canvasTheme.findUnique({ where: { organizationId: tenant.organization.id } })
  if (!theme) {
    theme = await db.canvasTheme.create({ data: { organizationId: tenant.organization.id } })
  }
  return theme
}

export async function updateCanvasTheme(data: Partial<{ primaryColor: string; accentColor: string; fontFamily: string; borderRadius: string; density: string; sidebarStyle: string; logoUrl: string }>) {
  const { tenant } = await ctx()
  await db.canvasTheme.upsert({
    where: { organizationId: tenant.organization.id },
    create: { organizationId: tenant.organization.id, ...data },
    update: data,
  })
  return getCanvasTheme()
}

export const THEME_TEMPLATES = [
  { name: 'Modern', primaryColor: '#3b82f6', accentColor: '#8b5cf6', fontFamily: 'Inter', borderRadius: 'medium', density: 'comfortable' },
  { name: 'Classic', primaryColor: '#1e40af', accentColor: '#0e7490', fontFamily: 'Roboto', borderRadius: 'small', density: 'comfortable' },
  { name: 'Dark', primaryColor: '#6366f1', accentColor: '#ec4899', fontFamily: 'Inter', borderRadius: 'medium', density: 'compact' },
  { name: 'Minimal', primaryColor: '#374151', accentColor: '#6b7280', fontFamily: 'Inter', borderRadius: 'none', density: 'spacious' },
  { name: 'Vibrant', primaryColor: '#f59e0b', accentColor: '#ef4444', fontFamily: 'Poppins', borderRadius: 'large', density: 'comfortable' },
] as const

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function listProfiles() {
  const { tenant } = await ctx()
  return db.roleProfile.findMany({
    where: { organizationId: tenant.organization.id },
    include: { _count: { select: { permissions: true, fieldPermissions: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createProfile(data: { name: string; description?: string }) {
  const { session, tenant } = await ctx()
  return db.roleProfile.create({
    data: { organizationId: tenant.organization.id, name: data.name, description: data.description },
  })
}

// ---------------------------------------------------------------------------
// Territories
// ---------------------------------------------------------------------------

export async function listTerritories() {
  const { tenant } = await ctx()
  return db.territory.findMany({
    where: { organizationId: tenant.organization.id },
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createTerritory(data: { name: string; managerId?: string; parentTerritoryId?: string }) {
  const { session, tenant } = await ctx()
  return db.territory.create({
    data: {
      organizationId: tenant.organization.id,
      name: data.name,
      managerId: data.managerId,
      parentTerritoryId: data.parentTerritoryId,
    },
  })
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function listEmailTemplates() {
  const { tenant } = await ctx()
  return db.emailTemplate.findMany({ where: { organizationId: tenant.organization.id }, orderBy: { createdAt: 'desc' } })
}

export async function createEmailTemplate(data: { name: string; subject: string; bodyHtml: string; category?: string }) {
  const { session, tenant } = await ctx()
  return db.emailTemplate.create({
    data: { organizationId: tenant.organization.id, ...data },
  })
}

export async function listPdfTemplates() {
  const { tenant } = await ctx()
  return db.pdfTemplate.findMany({ where: { organizationId: tenant.organization.id }, orderBy: { createdAt: 'desc' } })
}

export async function createPdfTemplate(data: { name: string; htmlTemplate: string; css?: string; category?: string }) {
  const { session, tenant } = await ctx()
  return db.pdfTemplate.create({
    data: { organizationId: tenant.organization.id, ...data },
  })
}
