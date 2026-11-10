import { db } from '@/lib/db'

export interface AuditInput {
  organizationId?: string | null
  actorId?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  ip?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown> | null
}

export async function audit(input: AuditInput) {
  try {
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
      },
    })
  } catch (e) {
    // Audit must never break the request.
    console.error('[audit] failed to write log', e)
  }
}

export async function recordLoginHistory(input: {
  userId?: string
  organizationId?: string | null
  ip?: string | null
  userAgent?: string | null
  success: boolean
  method: string
  metadata?: Record<string, unknown>
}) {
  if (!input.userId) return
  try {
    await db.loginHistory.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        success: input.success,
        method: input.method,
        metadata: JSON.stringify(input.metadata ?? {}),
      },
    })
  } catch (e) {
    console.error('[audit] login history write failed', e)
  }
}
