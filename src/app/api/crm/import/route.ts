import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { IMPORT_SPECS, MAX_IMPORT_ROWS, processImportRows } from '@/lib/crm/import-core'

export const dynamic = 'force-dynamic'

// Re-exported for existing consumers that imported it from this route.
export { IMPORT_SPECS }

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })
    const orgId = tenant.organization.id

    const body = await req.json().catch(() => null)
    const moduleName = String(body?.module ?? '')
    const rows: Record<string, unknown>[] = Array.isArray(body?.rows) ? body.rows : []
    const updateExisting = body?.updateExisting === true
    if (!IMPORT_SPECS[moduleName]) return NextResponse.json({ error: 'Unknown module' }, { status: 400 })
    if (rows.length === 0) return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
    if (rows.length > MAX_IMPORT_ROWS) return NextResponse.json({ error: `Max ${MAX_IMPORT_ROWS} rows per import` }, { status: 400 })

    // The full pipeline (validate → dedupe → account resolution → assignment
    // rules → insert/update) lives in the shared import core so the API
    // auto-import connector flows through exactly the same rules.
    const result = await processImportRows({ orgId, actorId: session.userId, module: moduleName, rows, updateExisting })

    await audit({
      organizationId: orgId,
      actorId: session.userId,
      action: `${moduleName}.bulk_import`,
      targetType: moduleName,
      metadata: { created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed, source: 'ui' },
    })

    return NextResponse.json(result)
  } catch (e) {
    const status = e instanceof Error && e.message === 'Unauthorized' ? 401
      : e instanceof Error && e.message === 'No organization' ? 403 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}
