import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { createModule } from '@/lib/customization/handler'
export const dynamic = 'force-dynamic'

/**
 * GET /api/custom-modules — module list for the Module Builder sidebar.
 * Includes disabled modules (they render with a "Disabled" badge so admins can
 * re-enable them). Legacy consumers wanting the old active-only behaviour can
 * pass ?activeOnly=true. Shape kept: { modules: [{ ...module, _count }] }.
 */
export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const activeOnly = new URL(req.url).searchParams.get('activeOnly') === 'true'
    const modules = await db.customModule.findMany({
      where: { organizationId: tenant.organization.id, ...(activeOnly ? { isActive: true } : {}) },
      include: { _count: { select: { fields: true, records: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ modules })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}

export async function POST(req: Request) {
  try { const body = await req.json().catch(() => null); if (!body?.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 }); const m = await createModule(body); return NextResponse.json({ id: m.id }, { status: 201 }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
