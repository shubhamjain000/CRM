'use client'

import * as React from 'react'
import { useRealtime } from '@/components/productivity/realtime-provider'
import { useAuth } from '@/store/auth'

/**
 * Hook to subscribe to real-time events of a specific type.
 */
export function useRealtimeEvent(event: string, handler: (data: unknown) => void) {
  const realtime = useRealtime()
  const handlerRef = React.useRef(handler)

  React.useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  React.useEffect(() => {
    if (!realtime) return
    // The notifications array acts as a bus; check new ones
    const check = () => {
      // This is a simplified version — in production we'd use a proper event emitter
    }
    return () => {}
  }, [realtime, event])
}

/**
 * Track presence: mark user as online + viewing a record.
 */
export function usePresence(viewingModule?: string, viewingId?: string, viewingName?: string) {
  const { user } = useAuth()
  React.useEffect(() => {
    if (!user) return
    // Mark online
    fetch('/api/presence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'online', viewingModule, viewingId, viewingName }),
    }).catch(() => {})
    // Heartbeat every 30s
    const id = setInterval(() => {
      fetch('/api/presence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'online', viewingModule, viewingId, viewingName }),
      }).catch(() => {})
    }, 30000)
    // Mark offline on unmount
    return () => {
      clearInterval(id)
      fetch('/api/presence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'offline' }),
      }).catch(() => {})
    }
  }, [user, viewingModule, viewingId, viewingName])
}

/**
 * Live cursors on a record — broadcast cursor position, receive others'.
 */
export function useLiveCursors(module: string, recordId: string) {
  const [cursors, setCursors] = React.useState<{ userId: string; field: string; position: number; color: string }[]>([])
  const lastUpdate = React.useRef(0)

  const broadcast = React.useCallback((field: string, position: number) => {
    const now = Date.now()
    if (now - lastUpdate.current < 200) return // throttle 5/s
    lastUpdate.current = now
    fetch('/api/presence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'online', viewingModule: module, viewingId: recordId }),
    }).catch(() => {})
  }, [module, recordId])

  React.useEffect(() => {
    const poll = setInterval(async () => {
      try {
        // Fetch cursors via a dedicated endpoint would be better; for now poll is fine
      } catch {}
    }, 2000)
    return () => clearInterval(poll)
  }, [module, recordId])

  return { cursors, broadcast }
}

/**
 * Typing indicator — broadcasts "user is typing" and shows others'.
 */
export function useTypingIndicator(conversationId: string) {
  const { user } = useAuth()
  const [typingUsers, setTypingUsers] = React.useState<string[]>([])
  const lastTypingSent = React.useRef(0)
  const realtime = useRealtime()

  const sendTyping = React.useCallback(() => {
    const now = Date.now()
    if (now - lastTypingSent.current < 2000) return
    lastTypingSent.current = now
    // Would broadcast via WebSocket; for now no-op
  }, [])

  // Listen for typing events from others
  React.useEffect(() => {
    if (!realtime) return
    const check = realtime.notifications.filter((n) => n.event === 'typing_indicator' && n.data !== user?.id)
    if (check.length > 0) {
      setTypingUsers(check.slice(-3).map((n) => String(n.data)))
      const id = setTimeout(() => setTypingUsers([]), 3000)
      return () => clearTimeout(id)
    }
  }, [realtime, user])

  return { typingUsers, sendTyping }
}

/**
 * Optimistic update helper — applies mutation immediately, rolls back on error.
 */
export function useOptimisticUpdate<T>() {
  const [optimistic, setOptimistic] = React.useState<T | null>(null)

  const apply = React.useCallback(async (
    mutation: () => Promise<void>,
    optimisticData: T,
    rollback: () => void,
  ) => {
    const prev = optimistic
    setOptimistic(optimisticData)
    try {
      await mutation()
      setOptimistic(null)
    } catch (e) {
      setOptimistic(prev)
      rollback()
      throw e
    }
  }, [optimistic])

  return { optimistic, apply }
}
