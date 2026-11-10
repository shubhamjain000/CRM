import { NextResponse } from 'next/server'

/**
 * Socket.IO relay: /socket.io/* → realtime mini-service (127.0.0.1:3003).
 *
 * Why: the realtime service is only reachable from the browser behind the
 * Caddy gateway (`?XTransformPort=3003`). On local runs without Caddy
 * (direct :3000 origin) socket.io requests would 404 and the client would
 * spam the console with failed websocket upgrades + retry noise. This
 * additive HTTP relay — same pattern as /api/whatsapp/live — makes the
 * engine.io POLLING transport work from every context with a plain relative
 * URL. (WebSocket upgrades keep flowing through the gateway when present;
 * through this relay the client stays on polling, which is fully functional.)
 *
 * Stateless pass-through — auth is enforced by the HMAC room token the
 * client fetches from /api/realtime/token; no data is stored here.
 */

const TARGET = 'http://127.0.0.1:3003'

async function relay(req: Request) {
  const url = new URL(req.url)
  // The realtime service mounts engine.io at path '/' (that is what the
  // Caddy gateway maps to) — rewrite the upstream path to '/' and keep the
  // full query (EIO/transport/sid + the XTransformPort marker, which
  // engine.io safely ignores).
  const target = `${TARGET}/${url.search}`
  try {
    const init: RequestInit = {
      method: req.method,
      headers: {
        'Content-Type': req.headers.get('content-type') ?? 'text/plain;charset=UTF-8',
      },
      // Engine.io long-poll GETs are held open server-side (~25s ping
      // interval) — the cap must sit above that so live polls aren't cut.
      signal: AbortSignal.timeout(35_000),
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = await req.text()
    }
    const res = await fetch(target, init)
    // undici auto-decompresses the upstream body; re-serving the stale
    // content-encoding/content-length headers would corrupt the stream.
    const headers = new Headers({
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    headers.delete('content-encoding')
    headers.delete('content-length')
    return new Response(res.body, { status: res.status, headers })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'realtime service unreachable' },
      { status: 502 },
    )
  }
}

export async function GET(req: Request) {
  return relay(req)
}

export async function POST(req: Request) {
  return relay(req)
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
