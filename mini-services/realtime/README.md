# Realtime Push Service

A standalone [bun](https://bun.sh) + [socket.io](https://socket.io) mini-service
that broadcasts productivity notifications (tasks, events, calls, generic
notifications) to authenticated rooms in real time.

It runs **independently** from the Next.js app on **port 3003** (hardcoded —
sandbox constraint) and is the single ingress point for server-pushed
notifications.

## Run

```bash
cd mini-services/realtime
bun install
bun run dev      # → bun --hot index.ts  (auto-restart on change)
```

On boot, the service prints:

```
[realtime] socket.io service listening on port 3003
[realtime] health:  GET  http://localhost:3003/health
[realtime] push:    POST http://localhost:3003/push  (header: x-internal-key)
[realtime] client:  io("/?XTransformPort=3003")
```

`bun --hot` watches `index.ts` and restarts the process on file changes —
ideal for development.

## Port & gateway

| What        | Value                         |
| ----------- | ----------------------------- |
| Port        | `3003` (hardcoded)            |
| socket path | `/` (required by Caddy)       |
| Browser URL | `io("/?XTransformPort=3003")` |

The sandbox only exposes port 3000 (the Next.js app) through a Caddy gateway.
To reach this service from the browser, the client connects to the Next.js
origin with the query param `XTransformPort=3003` — Caddy reads it and
forwards the WebSocket upgrade to port 3003. **Never** put the port in the
URL host; always use `XTransformPort`.

```ts
import { io } from 'socket.io-client'

const socket = io('/?XTransformPort=3003', {
  transports: ['websocket', 'polling'],
  reconnection: true,
})

// After auth, join the user's private room:
socket.emit('join_room', { room: `user:${userId}` })
// And / or the org broadcast room:
socket.emit('join_room', { room: `org:${orgId}` })
```

## Client → server events

| Event        | Payload                         | Effect                          |
| ------------ | ------------------------------- | ------------------------------- |
| `join_room`  | `{ room: 'user:<id>' \| 'org:<id>' }` | Subscribes the socket to the room. Server replies with `room_joined`. |
| `leave_room` | `{ room: '...' }`               | Unsubscribes. Server replies with `room_left`. |

## Server → client events (broadcasts)

These are the canonical event names the service will push to rooms. The
`/push` HTTP endpoint rejects anything not in this list.

| Event            | Payload                                                |
| ---------------- | ------------------------------------------------------ |
| `task.assigned`  | `{ task, assigneeId }`                                 |
| `task.reminder`  | `{ taskId, title, dueDate }`                           |
| `event.invited`  | `{ event, attendeeId }`                                |
| `event.reminder` | `{ eventId, title, start, offsetMinutes }`             |
| `call.logged`    | `{ call, relatedModule, relatedId }`                   |
| `notification`   | `{ title, body, type }` (generic catch-all)            |

## HTTP API (same port 3003)

### `GET /health`

```bash
curl http://localhost:3003/health
# → { "status": "ok", "service": "realtime", "port": 3003 }
```

### `POST /push`

Server-side endpoint used by Next.js API routes (or any trusted backend) to
broadcast an event to a room. Protected by a simple shared-secret header
`x-internal-key` — any **non-empty** value is accepted in dev.

```bash
curl -X POST http://localhost:3003/push \
  -H 'Content-Type: application/json' \
  -H 'x-internal-key: dev-secret' \
  -d '{
        "room": "user:abc123",
        "event": "task.assigned",
        "data": { "task": { "id": "t1", "title": "Call Acme" }, "assigneeId": "abc123" }
      }'
# → { "ok": true, "room": "user:abc123", "event": "task.assigned" }
```

Body schema:

```ts
interface PushBody {
  room: 'user:<userId>' | 'org:<orgId>'
  event:
    | 'task.assigned'
    | 'task.reminder'
    | 'event.invited'
    | 'event.reminder'
    | 'call.logged'
    | 'notification'
  data: unknown
}
```

Errors:

| Status | Cause                                            |
| ------ | ------------------------------------------------ |
| 400    | Invalid JSON body / bad room / unsupported event |
| 401    | Missing or empty `x-internal-key` header         |
| 404    | Unknown route                                    |

## Example Next.js usage

```ts
// src/lib/realtime.ts
const REALTIME_URL = 'http://localhost:3003'
const INTERNAL_KEY = process.env.REALTIME_INTERNAL_KEY ?? 'dev-secret'

export async function pushNotification(
  room: string,
  event: string,
  data: unknown,
): Promise<void> {
  await fetch(`${REALTIME_URL}/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': INTERNAL_KEY,
    },
    body: JSON.stringify({ room, event, data }),
  })
}
```

## Files

```
mini-services/realtime/
├── package.json     # bun project; dev script uses `bun --hot`
├── index.ts         # socket.io server + /push + /health (port 3003)
├── tsconfig.json    # strict TS config (bun-types)
└── README.md        # this file
```

## Design notes

- **Port 3003 is hardcoded** — the sandbox routes via the Caddy gateway using
  `XTransformPort`, and the spec mandates 3003 (no env override).
- **socket.io path is `/`** so the gateway can forward browser upgrades; the
  service also serves `/health` and `/push` on the same port by checking
  `res.writableEnded` and the `EIO`/`transport` query params to avoid
  clashing with socket.io's own request listener.
- **Event allow-list** in `/push` prevents arbitrary event injection.
- **CORS** is open (`origin: '*'`) per sandbox policy.
- **Graceful shutdown** on `SIGTERM`/`SIGINT` — `io.close()` disconnects
  clients before the http server closes.
