import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { ensureDefaultPipeline } from '@/lib/crm/convert'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await getTenant(session.userId)
  if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

  const pipelines = await db.pipeline.findMany({
    where: { organizationId: tenant.organization.id },
    include: { stages: { orderBy: { order: 'asc' } } },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json({ pipelines })
}

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await getTenant(session.userId)
  if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
  const id = await ensureDefaultPipeline(tenant.organization.id)
  return NextResponse.json({ pipelineId: id })
}
