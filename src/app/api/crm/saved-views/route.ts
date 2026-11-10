import { NextResponse } from 'next/server'
import { listSavedViews, createSavedView } from '@/lib/crm/ux'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const moduleName = url.searchParams.get('module') ?? 'lead'
    const views = await listSavedViews(moduleName)
    // Defensive parse — one corrupted config cell must not 500 the whole list.
    const safeParse = (raw: string | null): Record<string, unknown> => {
      try { return JSON.parse(raw || '{}') } catch { return {} }
    }
    return NextResponse.json({ views: views.map((v) => ({ ...v, config: safeParse(v.config) })) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    const view = await createSavedView(body)
    return NextResponse.json({ id: view.id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
