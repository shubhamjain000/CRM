import { NextResponse } from 'next/server'
import {
  INTEGRATION_CATALOG,
  listIntegrationsWithConfig,
  connectIntegrationWithConfig,
  disconnectIntegrationClean,
  listIntegrationLogs,
} from '@/lib/channels/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const withCatalog = url.searchParams.get('catalog') === 'true'
    const withLogs = url.searchParams.get('logs') === 'true'
    const [connected, logs] = await Promise.all([
      listIntegrationsWithConfig(),
      withLogs ? listIntegrationLogs(20) : Promise.resolve([]),
    ])
    // Strip credentials from config before returning.
    const safe = connected.map((i) => {
      let cfg: Record<string, unknown> = {}
      try { cfg = JSON.parse(i.config || '{}') } catch { cfg = {} }
      const redacted: Record<string, unknown> = {}
      for (const k of Object.keys(cfg)) redacted[k] = '••••••••'
      return { ...i, config: redacted }
    })
    return NextResponse.json({
      integrations: safe,
      catalog: withCatalog ? INTEGRATION_CATALOG : undefined,
      logs: withLogs ? logs : undefined,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.provider) return NextResponse.json({ error: 'Missing provider' }, { status: 400 })
    if (body.action === 'disconnect') {
      await disconnectIntegrationClean(body.provider)
      return NextResponse.json({ ok: true })
    }
    if (!body.config || typeof body.config !== 'object') {
      return NextResponse.json({ error: 'Missing config' }, { status: 400 })
    }
    const i = await connectIntegrationWithConfig(body.provider, body.config)
    return NextResponse.json({ id: i.id }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : msg.endsWith('is required') || msg.startsWith('Unknown provider') ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
