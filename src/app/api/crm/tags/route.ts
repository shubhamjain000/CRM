import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
export const dynamic = 'force-dynamic'

const TAG_COLORS = ['slate', 'red', 'amber', 'emerald', 'teal', 'sky', 'violet', 'pink'] as const

/**
 * GET  /api/crm/tags                       → every tag in the org
 * GET  /api/crm/tags?module=&recordId=     → tags with `linked` flag for one record
 * POST /api/crm/tags  { name, color? }     → create (idempotent per org+name)
 */
export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const url = new URL(req.url)
    const moduleId = url.searchParams.get('module')
    const recordId = url.searchParams.get('recordId')

    const tags = await db.tag.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
    })

    if (moduleId && recordId) {
      const links = await db.tagLink.findMany({
        where: { organizationId: orgId, module: moduleId, recordId },
        select: { tagId: true },
      })
      const linked = new Set(links.map((l) => l.tagId))
      return NextResponse.json({
        tags: tags.map((t) => ({ ...t, linked: linked.has(t.id) })),
      })
    }
    return NextResponse.json({ tags: tags.map((t) => ({ ...t, linked: false })) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const body = (await req.json().catch(() => null)) as { name?: unknown; color?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : ''
    if (!name) return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
    const color = TAG_COLORS.includes(body?.color as (typeof TAG_COLORS)[number])
      ? (body?.color as string)
      : 'slate'

    // Idempotent per org+name — re-typing an existing tag returns it instead of failing.
    const tag = await db.tag.upsert({
      where: { organizationId_name: { organizationId: orgId, name } },
      update: { color },
      create: { organizationId: orgId, name, color },
    })
    await audit({
      organizationId: orgId,
      actorId: session.userId,
      action: 'tag.create',
      targetType: 'tag',
      targetId: tag.id,
    })
    return NextResponse.json({ ...tag, linked: false }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
