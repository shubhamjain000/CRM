'use client'

import * as React from 'react'
import { io as ioFn, type Socket } from 'socket.io-client'

type Notification = {
  id: string
  event: string
  data: unknown
  time: number
}

interface RealtimeState {
  connected: boolean
  notifications: Notification[]
  join: (room: string) => void
  clear: () => void
}

const RealtimeContext = React.createContext<RealtimeState | null>(null)

export function useRealtime() {
  const ctx = React.useContext(RealtimeContext)
  return ctx
}

export function RealtimeProvider({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  const [connected, setConnected] = React.useState(false)
  const [notifications, setNotifications] = React.useState<Notification[]>([])
  const socketRef = React.useRef<Socket | null>(null)

  React.useEffect(() => {
    if (!userId) return
    let cancelled = false
    let socket: Socket | null = null

    // The realtime service requires a short-lived HMAC token on `join_room`
    // to prove the socket belongs to `userId`. Fetch it first, then connect.
    fetch('/api/realtime/token', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        if (cancelled || !data?.token) return
        // The realtime service mounts engine.io at path '/'. There are two
        // ways the browser can reach it:
        //   1) Gateway (Caddy): any `?XTransformPort=3003` request is
        //      forwarded to the service — connect with `path: '/'`.
        //   2) Next relay: the additive `/socket.io` route rewrites to the
        //      service's '/' — connect with `path: '/socket.io'` (local runs
        //      without Caddy).
        // Probe both with one cheap polling handshake each; if neither
        // answers (service not running), stay offline QUIETLY instead of
        // spamming the console with failing websocket upgrades and 404s.
        const probe = async (u: string) => {
          try {
            const res = await fetch(u, { cache: 'no-store' })
            return res.ok && (await res.text()).startsWith('0')
          } catch {
            return false
          }
        }
        let mode: 'gateway' | 'relay' | null = null
        if (await probe('/?XTransformPort=3003&EIO=4&transport=polling&t=probe')) mode = 'gateway'
        else if (cancelled) return
        else if (await probe('/socket.io?EIO=4&transport=polling&XTransformPort=3003&t=probe')) mode = 'relay'
        if (cancelled) return
        if (!mode) {
          console.info(
            '[realtime] service not reachable — live updates disabled. ' +
            'Start mini-services/realtime (bun run dev) to enable.',
          )
          return
        }
        socket = ioFn('/?XTransformPort=3003', mode === 'gateway'
          ? // Gateway handles websocket upgrades natively.
            { path: '/', transports: ['polling', 'websocket'], reconnection: true, reconnectionAttempts: 5 }
          : // Next relay is HTTP-only — stay on polling, never attempt an
            // upgrade that would fail and log console noise.
            { path: '/socket.io', addTrailingSlash: false, transports: ['polling'], upgrade: false, reconnection: true, reconnectionAttempts: 5 })
        socketRef.current = socket

        socket.on('connect', () => {
          setConnected(true)
          // Re-fetch a fresh token on every (re)connect — tokens are short-lived.
          fetch('/api/realtime/token', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((fresh) => {
              if (fresh?.token && socket?.connected) {
                socket.emit('join_room', { room: `user:${userId}`, token: fresh.token })
              }
            })
            .catch(() => {})
        })

        socket.on('disconnect', () => setConnected(false))

        const events = ['task.assigned', 'task.reminder', 'event.invited', 'event.reminder', 'call.logged', 'notification']
        for (const ev of events) {
          socket.on(ev, (data: unknown) => {
            setNotifications((prev) => [
              { id: Math.random().toString(36).slice(2), event: ev, data, time: Date.now() },
              ...prev.slice(0, 19),
            ])
          })
        }
      })
      .catch(() => {
        // Token endpoint unreachable (e.g. logged out) — don't connect.
      })

    return () => {
      cancelled = true
      if (socket) {
        socket.disconnect()
      }
      socketRef.current = null
    }
  }, [userId])

  const join = React.useCallback((room: string) => {
    // `join` is preserved for compatibility but the realtime service now
    // requires a token for any user room. We re-fetch and emit.
    fetch('/api/realtime/token', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.token) {
          socketRef.current?.emit('join_room', { room, token: data.token })
        }
      })
      .catch(() => {})
  }, [])

  const clear = React.useCallback(() => setNotifications([]), [])

  return (
    <RealtimeContext.Provider value={{ connected, notifications, join, clear }}>
      {children}
    </RealtimeContext.Provider>
  )
}
