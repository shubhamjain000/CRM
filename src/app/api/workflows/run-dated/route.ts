import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { runDueDateBasedRules } from '@/lib/crm/workflow-triggers'
export const dynamic = 'force-dynamic'

/**
 * Manual runner for date_based workflow rules ("Run due date-based" button).
 * For each active date_based rule: find the org's records whose configured
 * date field falls in the target day window (today ± offsetDays), skip ones
 * already fired today, then execute their actions.
 */
export async function POST() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 401 })

    const results = await runDueDateBasedRules({
      organizationId: tenant.organization.id,
      userId: session.userId,
    })
    return NextResponse.json({ results })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
