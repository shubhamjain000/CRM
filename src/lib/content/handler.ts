import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { logActivity } from '@/lib/crm/ux'
import { createHash, randomBytes } from 'crypto'
import { mkdir, writeFile, readFile, stat } from 'fs/promises'
import { join } from 'path'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

// ---------------------------------------------------------------------------
// Notes (Docs) — rich content with @mentions + #hashtags
// ---------------------------------------------------------------------------

export async function listNotes(opts: { relatedModule?: string; relatedId?: string; search?: string } = {}) {
  const { session, tenant } = await ctx()
  return db.doc.findMany({
    where: {
      organizationId: tenant.organization.id,
      deletedAt: null,
      ...(opts.relatedModule && opts.relatedId ? { relatedModule: opts.relatedModule, relatedId: opts.relatedId } : {}),
      ...(opts.search ? { title: { contains: opts.search } } : {}),
      OR: [{ authorId: session.userId }, { isPrivate: false }],
    },
    orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
    take: 50,
  })
}

export async function createNote(data: {
  title: string; body?: string; relatedModule?: string; relatedId?: string; isPrivate?: boolean
}) {
  const { session, tenant } = await ctx()
  const { mentions, hashtags } = parseMentionsHashtags(data.body ?? '')
  const note = await db.doc.create({
    data: {
      organizationId: tenant.organization.id,
      authorId: session.userId,
      title: data.title,
      body: data.body ?? '',
      isPrivate: data.isPrivate ?? false,
      relatedModule: data.relatedModule,
      relatedId: data.relatedId,
      mentions: JSON.stringify(mentions),
      hashtags: JSON.stringify(hashtags),
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'note.create', targetType: 'doc', targetId: note.id,
  })
  if (data.relatedModule && data.relatedId) {
    await logActivity({ module: data.relatedModule, recordId: data.relatedId, action: 'note_added', description: data.title })
  }
  return note
}

export async function updateNote(id: string, data: { title?: string; body?: string; isPinned?: boolean; isPrivate?: boolean }) {
  const { session, tenant } = await ctx()
  const existing = await db.doc.findFirst({
    where: { id, organizationId: tenant.organization.id, deletedAt: null },
  })
  if (!existing) throw new Error('Not found')

  const updateData: Record<string, unknown> = { ...data, lastEditedById: session.userId }
  if (data.body !== undefined) {
    const { mentions, hashtags } = parseMentionsHashtags(data.body)
    updateData.mentions = JSON.stringify(mentions)
    updateData.hashtags = JSON.stringify(hashtags)
    // Save a version snapshot
    const lastVersion = await db.docVersion.findFirst({
      where: { docId: id }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true },
    })
    await db.docVersion.create({
      data: {
        docId: id, userId: session.userId, body: existing.body,
        versionNumber: (lastVersion?.versionNumber ?? 0) + 1,
      },
    })
  }

  await db.doc.update({ where: { id }, data: updateData })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'note.update', targetType: 'doc', targetId: id,
  })
}

export async function deleteNote(id: string) {
  const { session, tenant } = await ctx()
  await db.doc.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { deletedAt: new Date() },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'note.delete', targetType: 'doc', targetId: id,
  })
}

export function parseMentionsHashtags(text: string): { mentions: string[]; hashtags: string[] } {
  const mentionMatches = text.match(/@[\w.]+/g) ?? []
  const hashtagMatches = text.match(/#[\w]+/g) ?? []
  return {
    mentions: [...new Set(mentionMatches.map((m) => m.slice(1)))],
    hashtags: [...new Set(hashtagMatches.map((h) => h.slice(1)))],
  }
}

// ---------------------------------------------------------------------------
// Files — upload, version, share, DLP
// ---------------------------------------------------------------------------

const UPLOAD_DIR = join(process.cwd(), '.data', 'uploads')

export async function uploadFile(opts: {
  name: string; mimeType: string; data: Buffer; relatedModule?: string; relatedId?: string
}) {
  const { session, tenant } = await ctx()
  const ext = opts.name.split('.').pop() ?? ''
  const storageKey = `${tenant.organization.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  // Ensure upload dir exists
  await mkdir(UPLOAD_DIR, { recursive: true })
  await writeFile(join(UPLOAD_DIR, storageKey.replace('/', '_')), opts.data)

  const file = await db.file.create({
    data: {
      organizationId: tenant.organization.id,
      name: opts.name,
      originalName: opts.name,
      size: opts.data.length,
      mimeType: opts.mimeType,
      extension: ext,
      storageKey,
      storageProvider: 'local',
      uploadedById: session.userId,
      relatedModule: opts.relatedModule,
      relatedId: opts.relatedId,
      virusScanStatus: 'skipped', // dev: skip ClamAV
    },
  })

  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'file.upload', targetType: 'file', targetId: file.id,
    metadata: { name: opts.name, size: opts.data.length },
  })

  // DLP check on text-based files
  if (opts.mimeType.startsWith('text/')) {
    const text = opts.data.toString('utf8')
    const pii = detectPII(text)
    if (pii.length > 0) {
      await audit({
        organizationId: tenant.organization.id, actorId: session.userId,
        action: 'file.dlp_flag', targetType: 'file', targetId: file.id,
        metadata: { findings: pii.slice(0, 5) },
      })
    }
  }

  return file
}

export async function listFiles(opts: { relatedModule?: string; relatedId?: string; starred?: boolean } = {}) {
  const { session, tenant } = await ctx()
  return db.file.findMany({
    where: {
      organizationId: tenant.organization.id,
      deletedAt: null,
      ...(opts.relatedModule && opts.relatedId ? { relatedModule: opts.relatedModule, relatedId: opts.relatedId } : {}),
      ...(opts.starred ? { isStarred: true } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

export async function getFile(id: string) {
  const { tenant } = await ctx()
  return db.file.findFirst({
    where: { id, organizationId: tenant.organization.id, deletedAt: null },
    include: { versions: { orderBy: { versionNumber: 'desc' } } },
  })
}

export async function deleteFile(id: string) {
  const { session, tenant } = await ctx()
  await db.file.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { deletedAt: new Date() },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'file.delete', targetType: 'file', targetId: id,
  })
}

export async function starFile(id: string, starred: boolean) {
  const { session, tenant } = await ctx()
  await db.file.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { isStarred: starred },
  })
}

export async function createShareLink(id: string, opts: {
  expiresHours?: number; password?: string; downloadLimit?: number; watermark?: boolean
}) {
  const { session, tenant } = await ctx()
  const token = randomBytes(16).toString('hex')
  const link = await db.shareLink.create({
    data: {
      fileId: id,
      token,
      createdById: session.userId,
      expiresAt: opts.expiresHours ? new Date(Date.now() + opts.expiresHours * 3600000) : null,
      passwordHash: opts.password ? createHash('sha256').update(opts.password).digest('hex') : null,
      downloadLimit: opts.downloadLimit,
      watermark: opts.watermark ?? true,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'file.share', targetType: 'file', targetId: id,
  })
  return link
}

export async function readFileData(storageKey: string): Promise<Buffer> {
  try {
    return await readFile(join(UPLOAD_DIR, storageKey.replace('/', '_')))
  } catch {
    throw new Error('File not found')
  }
}

/**
 * DLP: detect credit cards and SSNs in text.
 */
export function detectPII(text: string): string[] {
  const findings: string[] = []
  // Credit card (Visa/MC/Amex)
  const ccMatches = text.match(/\b(?:\d[ -]*?){13,16}\b/g) ?? []
  for (const m of ccMatches) {
    const digits = m.replace(/\D/g, '')
    if (digits.length >= 13 && digits.length <= 16 && luhnCheck(digits)) {
      findings.push(`credit_card:${digits.slice(-4)}`)
    }
  }
  // SSN
  const ssnMatches = text.match(/\b\d{3}-\d{2}-\d{4}\b/g) ?? []
  for (const m of ssnMatches) findings.push(`ssn:${m}`)
  return findings
}

function luhnCheck(num: string): boolean {
  let sum = 0
  let alt = false
  for (let i = num.length - 1; i >= 0; i--) {
    let n = parseInt(num[i], 10)
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

// ---------------------------------------------------------------------------
// Attachments — polymorphic join
// ---------------------------------------------------------------------------

export async function listAttachments(recordModule: string, recordId: string) {
  const { tenant } = await ctx()
  return db.attachment.findMany({
    where: { organizationId: tenant.organization.id, recordModule, recordId },
    include: { file: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
}

export async function attachFile(opts: {
  recordModule: string; recordId: string; fileId: string; description?: string; isInline?: boolean
}) {
  const { session, tenant } = await ctx()
  // Verify file belongs to tenant
  const file = await db.file.findFirst({
    where: { id: opts.fileId, organizationId: tenant.organization.id },
  })
  if (!file) throw new Error('File not found')

  return db.attachment.upsert({
    where: {
      recordModule_recordId_fileId: {
        recordModule: opts.recordModule,
        recordId: opts.recordId,
        fileId: opts.fileId,
      },
    },
    create: {
      organizationId: tenant.organization.id,
      recordModule: opts.recordModule,
      recordId: opts.recordId,
      fileId: opts.fileId,
      attachedById: session.userId,
      description: opts.description,
      isInline: opts.isInline ?? false,
    },
    update: {},
  })
}

export async function detachFile(attachmentId: string) {
  const { session, tenant } = await ctx()
  await db.attachment.deleteMany({
    where: { id: attachmentId, organizationId: tenant.organization.id },
  })
}
