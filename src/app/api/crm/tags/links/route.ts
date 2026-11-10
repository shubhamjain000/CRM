import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
export const dynamic = 'force-dynamic'

const TAGGABLE_MODULES = new Set(['lead', 'contact', 'account', 'deal'])

/**
 * POST /api/crm/tags/links — assign/unassign a tag on a record.
 * Body: { module, recordId, tagId, on: boolean }
 */
export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const body = (await req.json().catch(() => null)) as {
      module?: unknown; recordId?: unknown; tagId?: unknown; on?: unknown;
    } | null
    const moduleId = typeof body?.module === 'string' ? body.module : ''
    const recordId = typeof body?.recordId === 'string' ? body.recordId : ''
    const tagId = typeof body?.tagId === 'string' ? body.tagId : ''
    const on = body?.on !== false
    if (!TAGGABLE_MODULES.has(moduleId) || !recordId || !tagId) {
      return NextResponse.json({ error: 'module, recordId and tagId are required' }, { status: 400 })
    }

    // All three ids must belong to this tenant — prevents cross-org tag injection.
    const [tag, link] = await Promise.all([
      db.tag.findFirst({ where: { id: tagId, organizationId: orgId } }),
      on
        ? db.tagLink.findFirst({ where: { tagId, module: moduleId, recordId, organizationId: orgId } })
        : null,
    ])
    if (!tag) return NextResponse.json({ error: 'Tag not found' }, { status: 404 })

    if (on) {
      if (!link) {
        await db.tagLink.create({ data: { organizationId: orgId, tagId, module: moduleId, recordId } })
      }
    } else {
      await db.tagLink.deleteMany({ where: { organizationId: orgId, tagId, module: moduleId, recordId } })
    }
    return NextResponse.json({ ok: true, linked: on })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
