import { NextResponse } from 'next/server'

/**
 * Thin proxy: /api/whatsapp/live/* → WhatsApp connector mini-service (127.0.0.1:3010).
 *
 * Why: the Caddy gateway forwards `?XTransformPort=3010` in the deployed preview,
 * but this additive proxy makes the connector reachable from EVERY context
 * (direct :3000, gateway, tests) with a plain relative URL.
 * Stateless pass-through — no auth data stored here; the panel is gated
 * admin-only in the UI and the service holds no CRM data.
 */

const TARGET = 'http://127.0.0.1:3010'

async function proxy(req: Request, path: string[]) {
  const sub = (path ?? []).join('/')
  const url = new URL(req.url)
  const target = `${TARGET}/${sub}${url.search}`
  try {
    const init: RequestInit = {
      method: req.method,
      headers: { 'Content-Type': req.headers.get('content-type') ?? 'application/json' },
      // 20s cap — the panel polls fast endpoints; /start may take a few seconds.
      signal: AbortSignal.timeout(20_000),
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = await req.text()
    }
    const res = await fetch(target, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'connector service unreachable', status: 'unreachable' },
      { status: 502 },
    )
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path: rawPath } = await params
  return proxy(req, rawPath ?? [])
}

export async function POST(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path: rawPath } = await params
  return proxy(req, rawPath ?? [])
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
