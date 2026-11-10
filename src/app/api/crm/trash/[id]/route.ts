import { NextResponse } from 'next/server'
import { restoreFromTrash, purgeFromTrash } from '@/lib/crm/ux'
import type { CrmModule } from '@/lib/crm/handler'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const moduleName = body.module as CrmModule
    const action = body.action // 'restore' | 'purge'
    if (action === 'purge') {
      await purgeFromTrash(moduleName, id)
    } else {
      await restoreFromTrash(moduleName, id)
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
