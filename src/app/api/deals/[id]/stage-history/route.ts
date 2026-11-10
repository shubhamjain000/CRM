import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getTenant } from '@/lib/auth/tenant'
import { getSession } from '@/lib/auth/session'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const { id } = await params
    const history = await db.dealStageHistory.findMany({
      where: { dealId: id, organizationId: tenant.organization.id },
      include: {
        fromStage: { select: { name: true } },
        toStage: { select: { name: true } },
      },
      orderBy: { changedAt: 'desc' },
      take: 50,
    })
    return NextResponse.json({ history })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
