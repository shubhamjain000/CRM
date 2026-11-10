import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { listOrgMembers } from '@/lib/crm/assignment'

export const dynamic = 'force-dynamic'

/**
 * GET /api/crm/members — active members of the current organization.
 * Powers owner pickers (change owner, bulk assign, record forms) and the
 * owner-name lookup used by list columns.
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const members = await listOrgMembers(tenant.organization.id)
    return NextResponse.json({ members })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
