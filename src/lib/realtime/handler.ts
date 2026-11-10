import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { pushRealtime } from '@/lib/productivity/handler'
import { parseMentionsHashtags } from '@/lib/content/handler'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

// ---------------------------------------------------------------------------
// Feed posts
// ---------------------------------------------------------------------------

export async function listPosts(opts: { relatedModule?: string; relatedId?: string; limit?: number } = {}) {
  const { session, tenant } = await ctx()
  const isRecordFeed = !!(opts.relatedModule && opts.relatedId)
  const posts = await db.feedPost.findMany({
    where: {
      organizationId: tenant.organization.id,
      deletedAt: null,
      ...(isRecordFeed ? { relatedModule: opts.relatedModule, relatedId: opts.relatedId } : {}),
    },
    include: {
      _count: { select: { comments: true, reactions: true } },
      reactions: { select: { userId: true, emoji: true } },
    },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: opts.limit ?? 50,
  })
  // Aggregate reactions
  return posts.map((p) => ({
    ...p,
    authorName: '', // filled by caller if needed
    reactionCounts: aggregateReactions(p.reactions),
    myReactions: p.reactions.filter((r) => r.userId === session.userId).map((r) => r.emoji),
    commentCount: p._count.comments,
  }))
}

function aggregateReactions(reactions: { userId: string; emoji: string }[]) {
  const counts: Record<string, number> = {}
  for (const r of reactions) counts[r.emoji] = (counts[r.emoji] ?? 0) + 1
  return counts
}

export async function createPost(data: {
  body: string; relatedModule?: string; relatedId?: string; attachments?: string[]
}) {
  const { session, tenant } = await ctx()
  const { mentions, hashtags } = parseMentionsHashtags(data.body)
  const post = await db.feedPost.create({
    data: {
      organizationId: tenant.organization.id,
      authorId: session.userId,
      body: data.body,
      mentions: JSON.stringify(mentions),
      hashtags: JSON.stringify(hashtags),
      attachments: JSON.stringify(data.attachments ?? []),
      relatedModule: data.relatedModule,
      relatedId: data.relatedId,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'feed.post', targetType: 'feed_post', targetId: post.id,
  })
  // Notify mentioned users
  for (const userId of mentions) {
    if (userId === session.userId) continue
    await createNotification({
      actorId: session.userId, verb: 'mentioned',
      targetModule: data.relatedModule, targetId: data.relatedId,
      targetName: 'a post', recipientId: userId,
      data: { postId: post.id, body: data.body.slice(0, 100) },
    })
  }
  // Broadcast to org
  await pushRealtime(`org:${tenant.organization.id}`, 'comment_added', { post })
  return post
}

export async function deletePost(id: string) {
  const { session, tenant } = await ctx()
  await db.feedPost.updateMany({
    where: { id, organizationId: tenant.organization.id, authorId: session.userId },
    data: { deletedAt: new Date() },
  })
}

export async function toggleReaction(postId: string | null, commentId: string | null, emoji: string) {
  const { session, tenant } = await ctx()
  if (!postId && !commentId) throw new Error('Need postId or commentId')

  const where = {
    ...(postId ? { postId, userId_emoji: { userId: session.userId, emoji } } : {}),
    ...(commentId ? { commentId, userId_emoji: { userId: session.userId, emoji } } : {}),
  } as any

  const existing = await db.feedReaction.findFirst({
    where: {
      organizationId: tenant.organization.id,
      postId: postId ?? null,
      commentId: commentId ?? null,
      userId: session.userId,
      emoji,
    },
  })
  if (existing) {
    await db.feedReaction.delete({ where: { id: existing.id } })
    return { reacted: false }
  }
  await db.feedReaction.create({
    data: {
      organizationId: tenant.organization.id,
      postId, commentId, userId: session.userId, emoji,
    },
  })
  return { reacted: true }
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function listComments(postId: string) {
  const { tenant } = await ctx()
  return db.feedComment.findMany({
    where: { postId, organizationId: tenant.organization.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    include: { reactions: { select: { userId: true, emoji: true } } },
    take: 100,
  })
}

export async function createComment(postId: string, body: string) {
  const { session, tenant } = await ctx()
  const { mentions, hashtags } = parseMentionsHashtags(body)
  const comment = await db.feedComment.create({
    data: {
      organizationId: tenant.organization.id,
      postId, authorId: session.userId,
      body, mentions: JSON.stringify(mentions),
    },
  })
  // Notify post author
  const post = await db.feedPost.findUnique({ where: { id: postId }, select: { authorId: true } })
  if (post && post.authorId !== session.userId) {
    await createNotification({
      actorId: session.userId, verb: 'commented',
      targetModule: 'feed_post', targetId: postId,
      targetName: 'your post', recipientId: post.authorId,
      data: { commentId: comment.id, body: body.slice(0, 100) },
    })
  }
  await pushRealtime(`org:${tenant.organization.id}`, 'comment_added', { postId, comment })
  return comment
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function listNotifications(opts: { unreadOnly?: boolean; archived?: boolean } = {}) {
  const { session, tenant } = await ctx()
  return db.notification.findMany({
    where: {
      organizationId: tenant.organization.id,
      recipientId: session.userId,
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(opts.archived !== undefined ? { archived: opts.archived } : { archived: false }),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

export async function createNotification(data: {
  actorId?: string; verb: string
  targetModule?: string; targetId?: string; targetName?: string
  recipientId: string; data?: Record<string, unknown>; channel?: string
  /** System callers (job runner) pass the org directly — no session exists there. */
  organizationId?: string
}) {
  // Session-less path for background jobs: the caller supplies the org id.
  let organizationId = data.organizationId
  if (!organizationId) {
    const { tenant } = await ctx()
    organizationId = tenant.organization.id
  }
  const notif = await db.notification.create({
    data: {
      organizationId,
      actorId: data.actorId,
      verb: data.verb,
      targetModule: data.targetModule,
      targetId: data.targetId,
      targetName: data.targetName,
      recipientId: data.recipientId,
      channel: data.channel ?? 'in_app',
      data: JSON.stringify(data.data ?? {}),
    },
  })
  // Real-time push to recipient — includes the human message (when callers put
  // one in data.message) plus the deep-link coordinates so the mobile banner
  // and bell can navigate straight to the record.
  await pushRealtime(`user:${data.recipientId}`, 'notification', {
    id: notif.id, verb: data.verb, targetName: data.targetName,
    targetModule: data.targetModule, targetId: data.targetId,
    message: data.data?.message ?? null,
  })
  return notif
}

export async function markNotificationRead(id: string) {
  const { session, tenant } = await ctx()
  await db.notification.updateMany({
    where: { id, organizationId: tenant.organization.id, recipientId: session.userId },
    data: { readAt: new Date() },
  })
}

export async function markAllRead() {
  const { session, tenant } = await ctx()
  await db.notification.updateMany({
    where: { organizationId: tenant.organization.id, recipientId: session.userId, readAt: null },
    data: { readAt: new Date() },
  })
}

/**
 * Clear all = archive every notification for the recipient. Rows are kept so
 * history/audit stays intact; the list filters them out via archived=false.
 */
export async function archiveAllNotifications() {
  const { session, tenant } = await ctx()
  const res = await db.notification.updateMany({
    where: { organizationId: tenant.organization.id, recipientId: session.userId, archived: false },
    data: { archived: true },
  })
  return res.count
}

export async function getUnreadCount() {
  const { session, tenant } = await ctx()
  return db.notification.count({
    where: {
      organizationId: tenant.organization.id,
      recipientId: session.userId,
      readAt: null,
      archived: false,
    },
  })
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

export async function updatePresence(data: {
  status?: string; statusMessage?: string
  viewingModule?: string; viewingId?: string; viewingName?: string
}) {
  const { session, tenant } = await ctx()
  await db.userPresence.upsert({
    where: { userId: session.userId },
    create: {
      organizationId: tenant.organization.id,
      userId: session.userId,
      status: data.status ?? 'online',
      statusMessage: data.statusMessage,
      viewingModule: data.viewingModule,
      viewingId: data.viewingId,
      viewingName: data.viewingName,
      lastSeenAt: new Date(),
    },
    update: {
      status: data.status ?? 'online',
      statusMessage: data.statusMessage,
      viewingModule: data.viewingModule,
      viewingId: data.viewingId,
      viewingName: data.viewingName,
      lastSeenAt: new Date(),
    },
  })
  // Broadcast presence update to org
  await pushRealtime(`org:${tenant.organization.id}`, 'presence_update', {
    userId: session.userId, status: data.status ?? 'online',
  })
}

export async function listPresence() {
  const { tenant } = await ctx()
  return db.userPresence.findMany({
    where: { organizationId: tenant.organization.id, status: { not: 'offline' } },
    select: { userId: true, status: true, statusMessage: true, lastSeenAt: true,
      viewingModule: true, viewingId: true, viewingName: true },
    take: 100,
  })
}

// ---------------------------------------------------------------------------
// Live cursors
// ---------------------------------------------------------------------------

export async function updateCursor(data: {
  module: string; recordId: string; field: string; position: number; color?: string
}) {
  const { session, tenant } = await ctx()
  await db.liveCursor.upsert({
    where: { userId_module_recordId: { userId: session.userId, module: data.module, recordId: data.recordId } },
    create: {
      organizationId: tenant.organization.id,
      userId: session.userId, module: data.module, recordId: data.recordId,
      field: data.field, position: data.position, color: data.color ?? '#3b82f6',
    },
    update: { field: data.field, position: data.position, updatedAt: new Date() },
  })
  await pushRealtime(`org:${tenant.organization.id}`, 'cursor_update', {
    userId: session.userId, module: data.module, recordId: data.recordId,
    field: data.field, position: data.position, color: data.color ?? '#3b82f6',
  })
}

export async function getCursors(module: string, recordId: string) {
  const { session, tenant } = await ctx()
  const cutoff = new Date(Date.now() - 5000) // 5s TTL
  return db.liveCursor.findMany({
    where: {
      organizationId: tenant.organization.id,
      module, recordId,
      userId: { not: session.userId },
      updatedAt: { gte: cutoff },
    },
    select: { userId: true, field: true, position: true, color: true },
    take: 50,
  })
}
