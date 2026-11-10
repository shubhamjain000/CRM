import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { syncApiImport } from '@/lib/integrations/api-import'

export const dynamic = 'force-dynamic'

/** Manual "Sync now" for a connected API import feed. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    const integration = await db.integration.findFirst({
      where: { id, organizationId: tenant.organization.id },
    })
    if (!integration) return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    const outcome = await syncApiImport(integration)
    return NextResponse.json(outcome)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sync failed' }, { status: 500 })
  }
}
