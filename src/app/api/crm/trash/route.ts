import { NextResponse } from 'next/server'
import { listTrash, restoreFromTrash, purgeFromTrash } from '@/lib/crm/ux'
import type { CrmModule } from '@/lib/crm/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const moduleName = url.searchParams.get('module') ?? undefined
    const items = await listTrash(moduleName)
    return NextResponse.json({ items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
