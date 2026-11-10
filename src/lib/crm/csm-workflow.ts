/**
 * Server-side workflow for the Unstop CSM cadence.
 *
 * When a contact's next step changes the CRM must react on its own:
 *   1. stamp `csmNextStepAt` / `csmNextStepDueAt` (set date + step offset),
 *   2. complete any still-open auto follow-up tasks from the previous step,
 *   3. create the follow-up task for the new step (due date pre-filled),
 *   4. write a timeline entry so the cadence history is visible on the record.
 *
 * BI consumes the same columns, so reporting needs no extra wiring.
 */
import { db } from '@/lib/db'
import { CSM_VALUES, csmDueDate, csmStepMeta, csmTaskTitle } from '@/lib/csm'

/** Validate a client-supplied next step; returns the canonical value or throws a user-facing error. */
export function assertValidCsmStep(value: unknown): string {
  const step = String(value ?? '')
  if (!(CSM_VALUES as readonly string[]).includes(step)) {
    throw new Error(`Invalid next step: "${step}". Choose one of: ${CSM_VALUES.join(', ')}`)
  }
  return step
}

/** Server-managed date fields derived from a step value (never trust clients for these). */
export function csmServerFields(step: string, from: Date = new Date()): { csmNextStepAt: Date; csmNextStepDueAt: Date | null } {
  return { csmNextStepAt: from, csmNextStepDueAt: csmDueDate(step, from) }
}

/**
 * Reactions to a cadence step change. Best-effort: a failure here must not
 * make the (already persisted) step change look like it failed.
 */
export async function runCsmStepChange(opts: {
  organizationId: string
  actorId: string
  contactId: string
  contactName: string
  step: string
  dueAt: Date | null
  previousStep: string
}): Promise<void> {
  const { organizationId, actorId, contactId, contactName, step, dueAt, previousStep } = opts
  const now = new Date()
  const meta = csmStepMeta(step)
  try {
    // 1) Retire open auto follow-ups from the previous step.
    await db.task.updateMany({
      where: {
        organizationId,
        relatedModule: 'contact',
        relatedId: contactId,
        status: { in: ['not_started', 'in_progress'] },
        title: { startsWith: '[CSM]' },
      },
      data: { status: 'completed', lastActivity: now },
    })

    // 2) Create the follow-up task for the new step (Day 0/1 are hot → high priority).
    if (dueAt) {
      await db.task.create({
        data: {
          organizationId,
          title: csmTaskTitle(step, contactName),
          description: `Auto-created from the CSM cadence (${previousStep} → ${step}). ${meta.hint}.`,
          dueDate: dueAt,
          priority: meta.days !== null && meta.days <= 1 ? 'high' : 'medium',
          status: 'not_started',
          ownerId: actorId,
          createdById: actorId,
          assigneeId: actorId,
          relatedModule: 'contact',
          relatedId: contactId,
          lastActivity: now,
        },
      })
    }

    // 3) Timeline entry.
    await db.activity.create({
      data: {
        organizationId,
        userId: actorId,
        module: 'contact',
        recordId: contactId,
        recordName: contactName,
        action: 'csm_step_changed',
        description: `${previousStep} → ${step}${dueAt ? ` · follow-up due ${dueAt.toLocaleDateString()}` : ''}`,
        metadata: JSON.stringify({ step, previousStep, dueAt: dueAt ? dueAt.toISOString() : null }),
      },
    })
  } catch (e) {
    console.error('[csm] step side-effects failed', e)
  }
}

export function contactDisplayName(firstName?: string | null, lastName?: string | null): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Contact'
}
