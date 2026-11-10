/**
 * Realtime push service (socket.io)
 * --------------------------------
 * A standalone bun + socket.io mini-service that broadcasts productivity
 * notifications to authenticated rooms (`user:<id>` / `org:<id>`).
 *
 * The Next.js app pushes events to this service via an internal HTTP
 * `POST /push` endpoint; connected browser clients receive them in real
 * time through socket.io rooms.
 *
 * Port 3003 is hardcoded (sandbox constraint). The Caddy gateway in front
 * of the Next.js app exposes only the `/` route, so the browser connects
 * with `io("/?XTransformPort=3003")` and Caddy rewrites the upstream port
 * via the `XTransformPort` query param.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { Server, type Socket } from 'socket.io'
import cors from 'cors'
import { createHmac, timingSafeEqual } from 'crypto'

// ---------------------------------------------------------------------------
// Configuration (hardcoded per task spec — sandbox, single exposed port 3003)
// ---------------------------------------------------------------------------

const PORT = 3003
const SERVICE_NAME = 'realtime'

/**
 * Shared secret used to (a) authenticate the internal `/push` HTTP endpoint
 * (Next.js → this service) and (b) sign per-user short-lived tokens that
 * browsers present on `join_room` (so a browser can only subscribe to its
 * OWN `user:<id>` room — never anyone else's, and never arbitrary org rooms).
 *
 * In production set `REALTIME_INTERNAL_KEY` to a long random value. The dev
 * fallback is intentionally a fixed, well-known string so the sandbox works
 * without configuration; a loud warning is logged when the env var is missing.
 */
const SHARED_SECRET = process.env.REALTIME_INTERNAL_KEY?.trim() || ''
if (!SHARED_SECRET) {
  console.warn('[realtime] WARNING: REALTIME_INTERNAL_KEY env var not set — using insecure dev fallback. DO NOT ship this to production.')
}
const SECRET = SHARED_SECRET || 'dev-insecure-realtime-key'

/** Token lifetime: 1 hour. The browser re-fetches on reconnect. */
const TOKEN_TTL_MS = 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A room identifier. Rooms are namespaced by audience:
 *   - `user:<userId>`  → per-user private channel (task assigned, reminders…)
 *   - `org:<orgId>`    → per-organisation broadcast channel
 */
type Room = `user:${string}` | `org:${string}`

/** Payload shape for the `join_room` / `leave_room` client events. */
interface RoomPayload {
  room: Room
  /** HMAC-signed token from `/api/realtime/token`. Required to join `user:` rooms. */
  token?: string
}

/**
 * Canonical event names this service knows how to broadcast.
 * The `/push` HTTP endpoint rejects any event not in this set, preventing
 * arbitrary event injection from compromised API routes.
 */
type RealtimeEvent =
  | 'task.assigned' // { task, assigneeId }
  | 'task.reminder' // { taskId, title, dueDate }
  | 'event.invited' // { event, attendeeId }
  | 'event.reminder' // { eventId, title, start, offsetMinutes }
  | 'call.logged' // { call, relatedModule, relatedId }
  | 'notification' // { title, body, type } — generic catch-all

const ALLOWED_EVENTS: ReadonlySet<RealtimeEvent> = new Set<RealtimeEvent>([
  'task.assigned',
  'task.reminder',
  'event.invited',
  'event.reminder',
  'call.logged',
  'notification',
])

/** Body schema accepted by `POST /push`. */
interface PushBody {
  room: string
  event: RealtimeEvent
  data: unknown
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** True when `value` is a supported room identifier (`user:<id>` | `org:<id>`). */
function isRoom(value: unknown): value is Room {
  if (typeof value !== 'string') return false
  return /^user:[^\s]+$/i.test(value) || /^org:[^\s]+$/i.test(value)
}

/** True when `value` is one of the canonical realtime event names. */
function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  return typeof value === 'string' && ALLOWED_EVENTS.has(value as RealtimeEvent)
}

/**
 * Verify a client-presented token and return the userId it was issued to,
 * or `null` if the signature is wrong, the token is expired, or the format
 * is invalid. Tokens are `userId.exp.signatureHex` where signature covers
 * `userId + ':' + exp` HMAC-SHA256(secret). Constant-time compare on the
 * signature to defuse timing attacks.
 */
function verifyToken(rawToken: unknown): string | null {
  if (typeof rawToken !== 'string' || rawToken.length > 512) return null
  const parts = rawToken.split('.')
  if (parts.length !== 3) return null
  const [userId, expStr, sigHex] = parts
  if (!userId || !expStr || !sigHex) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Date.now()) return null
  const expected = createHmac('sha256', SECRET).update(`${userId}:${exp}`).digest('hex')
  const a = Buffer.from(sigHex)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null
  return userId
}

/** True if `room` is `user:<userId>` for the exact `userId` (the token bearer). */
function isOwnUserRoom(room: string, userId: string): boolean {
  return room === `user:${userId}`
}

// ---------------------------------------------------------------------------
// HTTP server + socket.io
// ---------------------------------------------------------------------------

const httpServer = createServer()

const io = new Server(httpServer, {
  // Path MUST stay '/' — the Caddy gateway uses it to forward browser
  // traffic to this service via the `XTransformPort=3003` query param.
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60_000,
  pingInterval: 25_000,
})

// ---------------------------------------------------------------------------
// Take ownership of HTTP request dispatch
// ---------------------------------------------------------------------------
// When socket.io is constructed with `path: '/'`, engine.io attaches a
// `request` listener that — because `req._parsedUrl` is undefined for plain
// HTTP routes — intercepts *every* request (including /health, /push) and
// replies with `{"code":0,"message":"Transport unknown"}`.
//
// To host our own HTTP routes on the same port, we save engine.io's request
// listeners, remove them, and re-dispatch manually: our routes (health, push)
// are answered directly; everything else is forwarded to engine.io (which
// performs the proper path + transport validation and serves the socket.io
// handshake / long-polling / WebSocket upgrade lifecycle).
const engineRequestListeners = httpServer
  .listeners('request')
  .slice() as Array<(req: IncomingMessage, res: ServerResponse) => void>
httpServer.removeAllListeners('request')

// Permissive CORS for the plain HTTP routes (/push, /health).
const corsHandler = cors({ origin: true, methods: ['GET', 'POST', 'OPTIONS'] })

/** Promisified CORS so we can `await` it inside the async request handler. */
function applyCors(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return new Promise((resolve) => corsHandler(req, res, () => resolve()))
}

/** Forward a request to engine.io (socket.io's transport layer). */
function delegateToEngine(req: IncomingMessage, res: ServerResponse): void {
  for (const listener of engineRequestListeners) {
    listener.call(httpServer, req, res)
    if (res.writableEnded) return
  }
}

// ---------------------------------------------------------------------------
// HTTP routes — share the same port (3003) as socket.io
// ---------------------------------------------------------------------------

httpServer.on('request', async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  // The socket.io path is '/' — delegate any request whose pathname is '/'
  // (with or without EIO/transport query params) to engine.io so the socket
  // handshake, long-polling fallback, and WebSocket upgrade all work.
  if (url.pathname === '/') {
    delegateToEngine(req, res)
    return
  }

  // Apply CORS to every plain HTTP route we own.
  await applyCors(req, res)
  if (res.writableEnded) return // cors may have ended a pre-flight

  // ---- GET /health --------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({ status: 'ok', service: SERVICE_NAME, port: PORT }),
    )
    return
  }

  // ---- POST /push ---------------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/push') {
    // Shared-secret guard: the header must EXACTLY equal the configured secret.
    // (Previously this accepted any non-empty value, which leaked the ability
    // to broadcast arbitrary events into any user's room to anyone who could
    // reach port 3003.)
    const rawKey = req.headers['x-internal-key']
    const internalKey = Array.isArray(rawKey) ? rawKey[0] : rawKey
    if (!internalKey || internalKey !== SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({ error: 'invalid or missing x-internal-key header' }),
      )
      return
    }

    const body = await readJsonBody<PushBody>(req)
    if (!body) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid or empty JSON body' }))
      return
    }

    if (!isRoom(body.room)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: 'invalid room; expected `user:<id>` or `org:<id>`',
        }),
      )
      return
    }

    if (!isRealtimeEvent(body.event)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: 'unsupported event',
          allowed: [...ALLOWED_EVENTS],
        }),
      )
      return
    }

    // Broadcast to the target room.
    io.to(body.room).emit(body.event, body.data)
    console.log(
      `[push] room=${body.room} event=${body.event} data=${JSON.stringify(body.data).slice(0, 200)}`,
    )

    res.writeHead(202, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, room: body.room, event: body.event }))
    return
  }

  // ---- Unknown route ------------------------------------------------------
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

/** Reads & parses a JSON body from an incoming HTTP request. */
function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw) return resolve(null)
      try {
        resolve(JSON.parse(raw) as T)
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

// ---------------------------------------------------------------------------
// Socket.io connection lifecycle
// ---------------------------------------------------------------------------

io.on('connection', (socket: Socket) => {
  console.log(`[connect] socket=${socket.id}`)

  // Client joins a room: { room: 'user:<id>', token: '<hmac>' }
  //
  // SECURITY: `user:<id>` rooms are PRIVATE — they receive task assignments,
  // reminders, and notifications addressed to that user. Without token
  // verification any browser could `join_room({ room: 'user:<victim>' })` and
  // silently read another user's notifications. We therefore require an
  // HMAC-signed token (issued by /api/realtime/token) and verify that the
  // room's userId matches the token's subject.
  //
  // `org:<id>` rooms are NOT joinable from the browser: only the internal
  // `/push` HTTP endpoint (which is secret-guarded) may broadcast into them,
  // and the Next.js side is expected to fan out org broadcasts by pushing to
  // each member's `user:<id>` room. This keeps the trust boundary simple.
  socket.on('join_room', (payload: RoomPayload) => {
    if (!isRoom(payload?.room)) {
      socket.emit('error', {
        message: 'invalid room; expected `user:<id>` or `org:<id>`',
      })
      return
    }
    const room = payload.room
    if (room.startsWith('org:')) {
      // Browsers cannot join org rooms directly. The server-side push fan-out
      // is the only path for org-wide broadcasts.
      socket.emit('error', {
        message: 'org rooms are not directly joinable; subscribe via your user room',
      })
      return
    }
    const tokenUserId = verifyToken(payload?.token)
    if (!tokenUserId) {
      socket.emit('error', { message: 'invalid or expired token' })
      return
    }
    if (!isOwnUserRoom(room, tokenUserId)) {
      // Token is valid for a different user — reject hard. This is the
      // spoofing attempt we are defending against.
      socket.emit('error', { message: 'token does not match room' })
      return
    }
    socket.join(room)
    console.log(`[join_room] socket=${socket.id} room=${room}`)
    socket.emit('room_joined', { room })
  })

  // Client leaves a room.
  socket.on('leave_room', (payload: RoomPayload) => {
    if (!isRoom(payload?.room)) return
    socket.leave(payload.room)
    console.log(`[leave_room] socket=${socket.id} room=${payload.room}`)
    socket.emit('room_left', { room: payload.room })
  })

  socket.on('disconnect', (reason: string) => {
    console.log(`[disconnect] socket=${socket.id} reason=${reason}`)
  })

  socket.on('error', (err: Error) => {
    console.error(`[socket-error] socket=${socket.id}`, err)
  })
})

// ---------------------------------------------------------------------------
// Boot + graceful shutdown
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  console.log(`[realtime] socket.io service listening on port ${PORT}`)
  console.log(`[realtime] health:  GET  http://localhost:${PORT}/health`)
  console.log(
    `[realtime] push:    POST http://localhost:${PORT}/push  (header: x-internal-key)`,
  )
  console.log(`[realtime] client:  io("/?XTransformPort=3003")`)
})

const shutdown = (signal: string) => {
  console.log(`[realtime] received ${signal}, shutting down...`)
  // `io.close()` also disconnects all connected sockets.
  io.close(() => {
    httpServer.close(() => {
      console.log('[realtime] closed')
      process.exit(0)
    })
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
