'use client'

import * as React from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface PresenceUser {
  userId: string; status: string; statusMessage?: string | null
  lastSeenAt: string; viewingModule?: string | null; viewingName?: string | null
}

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-emerald-500', away: 'bg-amber-500', busy: 'bg-destructive',
  dnd: 'bg-destructive', offline: 'bg-muted-foreground',
}

export function PresenceIndicator({ userId, size = 'sm' }: { userId: string; size?: 'sm' | 'md' }) {
  const [status, setStatus] = React.useState<string>('offline')

  React.useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/presence', { cache: 'no-store' })
        const data = await res.json()
        const u = (data.presence ?? []).find((p: PresenceUser) => p.userId === userId)
        if (!cancelled) setStatus(u?.status ?? 'offline')
      } catch {}
    }
    poll()
    const id = setInterval(poll, 15000)
    return () => { cancelled = true; clearInterval(id) }
  }, [userId])

  const dot = size === 'sm' ? 'size-2.5' : 'size-3'
  const offset = size === 'sm' ? 'bottom-0 right-0' : 'bottom-0.5 right-0.5'

  return (
    <div className="relative inline-block">
      <Avatar className={size === 'sm' ? 'size-7' : 'size-9'}>
        <AvatarFallback className="bg-primary/10 text-primary text-xs">
          {userId.slice(-2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className={`absolute ${offset} ${dot} rounded-full border-2 border-background ${STATUS_COLORS[status] ?? STATUS_COLORS.offline}`} />
    </div>
  )
}

export function PresenceList() {
  const [users, setUsers] = React.useState<PresenceUser[]>([])

  React.useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/presence', { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled) setUsers(data.presence ?? [])
      } catch {}
    }
    poll()
    const id = setInterval(poll, 15000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (users.length === 0) return null

  return (
    <div className="flex items-center gap-1.5">
      {users.slice(0, 5).map((u) => (
        <div key={u.userId} className="relative" title={`${u.status}${u.statusMessage ? ': ' + u.statusMessage : ''}`}>
          <Avatar className="size-7">
            <AvatarFallback className="bg-muted text-[10px]">{u.userId.slice(-2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className={`absolute bottom-0 right-0 size-2 rounded-full border border-background ${STATUS_COLORS[u.status] ?? STATUS_COLORS.offline}`} />
        </div>
      ))}
      {users.length > 5 && (
        <span className="text-xs text-muted-foreground">+{users.length - 5}</span>
      )}
    </div>
  )
}
