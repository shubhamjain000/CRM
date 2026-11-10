import { NextResponse } from 'next/server'
import { listIntegrations, connectIntegration, disconnectIntegration, saveApiImport, testIntegration } from '@/lib/ecosystem/handler'
import { publicSpecs } from '@/lib/integrations/providers'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // `specs` carries the public per-provider connect flows (steps + field
    // schemas) so the UI can render guided wizards without duplicating them.
    return NextResponse.json({ integrations: await listIntegrations(), specs: publicSpecs() })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.provider && body?.action !== 'save_api_import') return NextResponse.json({ error: 'Missing provider' }, { status: 400 })
    if (body.action === 'save_api_import') {
      const i = await saveApiImport(body.config ?? {})
      return NextResponse.json({ id: i.id })
    }
    if (body.action === 'disconnect') { await disconnectIntegration(body.provider); return NextResponse.json({ ok: true }) }
    if (body.action === 'test') {
      const out = await testIntegration(String(body.id ?? ''))
      return NextResponse.json(out)
    }
    const i = await connectIntegration(body.provider, typeof body.values === 'object' && body.values !== null ? body.values : undefined)
    return NextResponse.json({ id: i.id }, { status: 201 })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
