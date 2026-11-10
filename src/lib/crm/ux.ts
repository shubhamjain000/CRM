import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import type { CrmModule } from './handler'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export interface SavedViewConfig {
  filters?: Record<string, string>
  sort?: string
  columns?: string[]
  search?: string
}

export async function listSavedViews(module: string) {
  const { session, tenant } = await ctx()
  return db.savedView.findMany({
    where: {
      organizationId: tenant.organization.id,
      module,
      OR: [{ userId: session.userId }, { isShared: true }],
    },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    take: 100,
  })
}

export async function createSavedView(input: {
  module: string; name: string; config: SavedViewConfig; isShared?: boolean
}) {
  const { session, tenant } = await ctx()
  // Cap per user+module so the saved-filter dropdown stays usable.
  const count = await db.savedView.count({
    where: { organizationId: tenant.organization.id, userId: session.userId, module: input.module },
  })
  if (count >= 10) {
    throw new Error('You can save up to 10 filters per module — delete one to add another.')
  }
  const view = await db.savedView.create({
    data: {
      organizationId: tenant.organization.id,
      userId: session.userId,
      module: input.module,
      name: input.name,
      isShared: input.isShared ?? false,
      config: JSON.stringify(input.config),
    },
  })
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: 'saved_view.create',
    targetType: 'saved_view',
    targetId: view.id,
  })
  return view
}

export async function deleteSavedView(id: string) {
  const { session, tenant } = await ctx()
  await db.savedView.deleteMany({
    where: { id, organizationId: tenant.organization.id, userId: session.userId },
  })
}

// ---------------------------------------------------------------------------
// Recently viewed
// ---------------------------------------------------------------------------

export async function trackView(module: string, recordId: string, recordName: string) {
  const { session, tenant } = await ctx()
  await db.recentlyViewed.upsert({
    where: {
      organizationId_userId_module_recordId: {
        organizationId: tenant.organization.id,
        userId: session.userId,
        module,
        recordId,
      },
    },
    create: {
      organizationId: tenant.organization.id,
      userId: session.userId,
      module, recordId, recordName, viewedAt: new Date(),
    },
    update: { recordName, viewedAt: new Date() },
  })
}

export async function listRecentlyViewed(module?: string, limit = 10) {
  const { session, tenant } = await ctx()
  return db.recentlyViewed.findMany({
    where: {
      organizationId: tenant.organization.id,
      userId: session.userId,
      ...(module ? { module } : {}),
    },
    orderBy: { viewedAt: 'desc' },
    take: limit,
  })
}

// ---------------------------------------------------------------------------
// Activity timeline
// ---------------------------------------------------------------------------

export async function logActivity(input: {
  module: string; recordId: string; recordName?: string
  action: string; description?: string; metadata?: Record<string, unknown>
}) {
  const { session, tenant } = await ctx()
  return db.activity.create({
    data: {
      organizationId: tenant.organization.id,
      userId: session.userId,
      module: input.module,
      recordId: input.recordId,
      recordName: input.recordName ?? '',
      action: input.action,
      description: input.description ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
    },
  })
}

export async function getTimeline(module: string, recordId: string) {
  const { tenant } = await ctx()
  const [activities, notes] = await Promise.all([
    db.activity.findMany({
      where: { organizationId: tenant.organization.id, module, recordId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db.note.findMany({
      where: { organizationId: tenant.organization.id, module, recordId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ])

  const items = [
    ...activities.map((a) => ({ ...a, type: 'activity' as const })),
    ...notes.map((n) => ({ ...n, type: 'note' as const })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return groupByDate(items)
}

function groupByDate<T extends { createdAt: Date }>(items: T[]): Record<string, T[]> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)

  const groups: Record<string, T[]> = { Today: [], Yesterday: [], 'This Week': [], Earlier: [] }
  for (const item of items) {
    const d = new Date(item.createdAt)
    if (d >= today) groups.Today.push(item)
    else if (d >= yesterday) groups.Yesterday.push(item)
    else if (d >= weekAgo) groups['This Week'].push(item)
    else groups.Earlier.push(item)
  }
  // Remove empty groups
  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length > 0))
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function listNotes(module: string, recordId: string, kind?: string) {
  const { tenant } = await ctx()
  return db.note.findMany({
    where: {
      organizationId: tenant.organization.id, module, recordId,
      ...(kind && (NOTE_KINDS as readonly string[]).includes(kind) ? { kind } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
}

export const NOTE_KINDS = [
  'general', 'call-outcome', 'day-0', 'day-1-reconnect', 'day-3-followup',
  'week-1-checkin', 'week-2-update', 'month-1-review', 'meeting', 'email',
  'quote-sent', 'payment-reminder', 'objection', 'next-steps',
] as const

export async function createNote(module: string, recordId: string, body: string, kind?: string) {
  const { session, tenant } = await ctx()
  const { mentions, hashtags } = parseMentionsAndHashtags(body)
  const noteKind = kind && (NOTE_KINDS as readonly string[]).includes(kind) ? kind : 'general'
  const note = await db.note.create({
    data: {
      organizationId: tenant.organization.id,
      userId: session.userId,
      module, recordId, body,
      kind: noteKind,
      mentions: JSON.stringify(mentions),
      hashtags: JSON.stringify(hashtags),
    },
  })
  await logActivity({ module, recordId, action: 'note_added', description: body.slice(0, 100) })
  return note
}

export function parseMentionsAndHashtags(text: string): { mentions: string[]; hashtags: string[] } {
  const mentionMatches = text.match(/@[\w.]+/g) ?? []
  const hashtagMatches = text.match(/#[\w]+/g) ?? []
  return {
    mentions: mentionMatches.map((m) => m.slice(1)),
    hashtags: hashtagMatches.map((h) => h.slice(1)),
  }
}

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

export async function listTrash(module?: string) {
  const { tenant } = await ctx()
  const orgId = tenant.organization.id
  const result: { id: string; module: string; name: string; deletedAt: Date }[] = []

  const modules = module ? [module] : (['lead', 'contact', 'account', 'deal'] as const)
  for (const m of modules) {
    const delegate = db[m] as any
    const select: Record<string, boolean> = { id: true, deletedAt: true }
    if (m === 'account' || m === 'deal') select.name = true
    if (m === 'lead' || m === 'contact') { select.firstName = true; select.lastName = true }
    if (m === 'lead') select.company = true

    const records = await delegate.findMany({
      where: { organizationId: orgId, deletedAt: { not: null } },
      select,
      orderBy: { deletedAt: 'desc' },
      take: 100,
    })
    for (const r of records) {
      const name = (r.name ?? `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim()) || r.company || r.id.slice(-8)
      result.push({ id: r.id, module: m, name, deletedAt: r.deletedAt })
    }
  }
  return result.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime())
}

export async function restoreFromTrash(module: CrmModule, recordId: string) {
  const { session, tenant } = await ctx()
  const delegate = db[module] as any
  await delegate.updateMany({
    where: { id: recordId, organizationId: tenant.organization.id },
    data: { deletedAt: null },
  })
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: `${module}.restore`,
    targetType: module,
    targetId: recordId,
  })
}

export async function purgeFromTrash(module: CrmModule, recordId: string) {
  const { session, tenant } = await ctx()
  const delegate = db[module] as any
  await delegate.deleteMany({
    where: { id: recordId, organizationId: tenant.organization.id, deletedAt: { not: null } },
  })
  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: `${module}.purge`,
    targetType: module,
    targetId: recordId,
  })
}

// ---------------------------------------------------------------------------
// Search query parser: owner:me stage:negotiation amount:>50000
// ---------------------------------------------------------------------------

export interface ParsedSearch {
  text: string
  filters: Record<string, string>
}

export function parseSearchQuery(query: string): ParsedSearch {
  const filters: Record<string, string> = {}
  const textParts: string[] = []
  const tokenRegex = /(\w+):(?:"([^"]+)"|(\S+))|\S+/g
  let match
  while ((match = tokenRegex.exec(query)) !== null) {
    if (match[1]) {
      // key:value
      filters[match[1]] = match[2] ?? match[3]
    } else {
      textParts.push(match[0])
    }
  }
  return { text: textParts.join(' '), filters }
}

export const SEARCH_OPERATORS_HELP = [
  { op: 'owner:me', desc: 'Records owned by you' },
  { op: 'stage:negotiation', desc: 'Filter by stage name' },
  { op: 'amount:>50000', desc: 'Amount greater than' },
  { op: 'amount:<10000', desc: 'Amount less than' },
  { op: 'status:qualified', desc: 'Filter by status' },
  { op: 'created:today', desc: 'Created today' },
  { op: 'close:this_month', desc: 'Closing this month' },
] as const
