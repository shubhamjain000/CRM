'use client'

import * as React from 'react'
import {
  AtSign, Bell, BellOff, BellRing, CheckCheck, CheckSquare, Loader2,
  MessageSquare, RotateCw, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useRealtime } from '@/components/productivity/realtime-provider'
import { toast } from 'sonner'
import {
  NOTIFICATION_GROUPS, dispatchNotificationNavigate, notificationMessage,
  timeAgo, verbGroup, type NotificationGroup, type NotificationLike,
} from './notification-shared'

interface Notification extends NotificationLike {
  readAt: string | null
}

const GROUP_ICON: Record<Exclude<NotificationGroup, 'all'>, React.ElementType> = {
  mentions: AtSign,
  tasks: CheckSquare,
  messages: MessageSquare,
  system: Bell,
}

export function NotificationBell() {
  const realtime = useRealtime()
  const [notifications, setNotifications] = React.useState<Notification[]>([])
  const [unread, setUnread] = React.useState(0)
  const [loadedOnce, setLoadedOnce] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState<NotificationGroup>('all')
  const [clearConfirmOpen, setClearConfirmOpen] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [pushPermission, setPushPermission] = React.useState<NotificationPermission | 'unsupported'>('default')
  // Track the last real-time notification we toasted so unrelated realtime
  // updates don't re-toast the same notification (and re-fetch) repeatedly.
  const lastToastedId = React.useRef<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load notifications')
      const data = await res.json()
      setNotifications(data.notifications ?? [])
      setUnread(data.unreadCount ?? 0)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load notifications')
    } finally {
      setLoadedOnce(true)
    }
  }, [])

  const refreshPushPermission = React.useCallback(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPushPermission('unsupported')
      return
    }
    setPushPermission(Notification.permission)
  }, [])

  React.useEffect(() => { load(); refreshPushPermission() }, [load, refreshPushPermission])

  // Poll for new notifications (in addition to real-time push)
  React.useEffect(() => {
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [load])

  // Show toast when a new real-time notification arrives
  React.useEffect(() => {
    if (!realtime) return
    const latest = realtime.notifications.find((n) => n.event === 'notification')
    if (latest && latest.id !== lastToastedId.current) {
      lastToastedId.current = latest.id
      const data = (latest.data ?? {}) as { verb?: string; message?: string; targetName?: string }
      toast.info(data.message || data.verb || 'Notification', {
        description: data.message ? data.targetName : undefined,
      })
      load()
    }
  }, [realtime, load])

  /** Optimistically flip one row read and keep the badge accurate at once. */
  const markRead = async (n: Notification) => {
    if (!n.readAt) setUnread((u) => Math.max(0, u - 1))
    setNotifications((prev) => prev.map((x) => (x.id === n.id && !x.readAt ? { ...x, readAt: new Date().toISOString() } : x)))
    try {
      const res = await fetch(`/api/notifications/${n.id}`, { method: 'PATCH' })
      if (!res.ok) throw new Error('Could not mark as read')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark as read')
    }
  }

  const markAll = async () => {
    setUnread(0)
    setNotifications((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })))
    try {
      const res = await fetch('/api/notifications/mark-all-read', { method: 'POST' })
      if (!res.ok) throw new Error('Could not mark all as read')
      toast.success('All marked read')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark all as read')
    }
  }

  const clearAll = async () => {
    setClearing(true)
    try {
      const res = await fetch('/api/notifications/clear-all', { method: 'POST' })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || 'Could not clear notifications')
      // Server archives everything → count is 0 immediately; poll self-corrects.
      setNotifications([])
      setUnread(0)
      toast.success(`Cleared ${d?.archived ?? 'all'} notification${d?.archived === 1 ? '' : 's'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear notifications')
    } finally {
      setClearing(false)
      setClearConfirmOpen(false)
    }
  }

  const requestPush = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    try {
      const result = await Notification.requestPermission()
      setPushPermission(result)
      if (result === 'granted') toast.success('Push notifications enabled')
      else if (result === 'denied') toast.error('Push blocked — enable it in your browser site settings')
    } catch {
      toast.error('Could not request push permission')
    }
  }

  const onItemClick = (n: Notification) => {
    void markRead(n)
    const ok = dispatchNotificationNavigate(n)
    if (!ok) toast.info(notificationMessage(n) || 'Notification', { description: 'No destination for this notification' })
  }

  const filtered = notifications.filter((n) => filter === 'all' || verbGroup(n.verb) === filter)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-9" aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}>
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] max-w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-white">{unread} new</span>
          )}
        </div>
        <div className="flex gap-1 px-3 pb-2">
          {NOTIFICATION_GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setFilter(g.key)}
              className={`min-h-7 shrink-0 rounded-full border px-2.5 text-xs transition-colors ${
                filter === g.key
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <DropdownMenuSeparator className="my-0" />
        {!loadedOnce ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              <RotateCw className="mr-1.5 size-3.5" /> Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No notifications</div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {filtered.slice(0, 20).map((n) => {
              const group = verbGroup(n.verb)
              const Icon = GROUP_ICON[group]
              const message = notificationMessage(n)
              return (
                <DropdownMenuItem
                  key={n.id}
                  className="flex-col items-start gap-0.5 py-2"
                  onClick={() => onItemClick(n)}
                >
                  <div className="flex w-full items-center gap-2">
                    <Icon className={`size-3.5 shrink-0 ${n.readAt ? 'text-muted-foreground' : 'text-primary'}`} aria-hidden />
                    <span className={`min-w-0 flex-1 truncate text-sm ${n.readAt ? 'text-muted-foreground' : 'font-medium'}`}>
                      {message || n.verb}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    {!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-label="unread" />}
                  </div>
                  {n.targetName && <p className="pl-5.5 text-xs text-muted-foreground">{n.targetName}</p>}
                </DropdownMenuItem>
              )
            })}
          </div>
        )}
        <DropdownMenuSeparator className="my-0" />
        <div className="flex items-center justify-between gap-1 p-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={markAll} disabled={unread === 0}>
            <CheckCheck className="mr-1 size-3" /> Mark all read
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive hover:text-destructive" onClick={() => setClearConfirmOpen(true)} disabled={notifications.length === 0}>
            <Trash2 className="mr-1 size-3" /> Clear all
          </Button>
        </div>
        <div className="px-2 pb-2">
          {pushPermission === 'granted' ? (
            <p className="flex items-center gap-1.5 px-1 py-1 text-xs text-emerald-600">
              <BellRing className="size-3" /> Push notifications enabled
            </p>
          ) : pushPermission === 'denied' ? (
            <p className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground" title="Blocked in your browser settings — notifications will only appear in-app">
              <BellOff className="size-3" /> Push blocked in browser settings
            </p>
          ) : pushPermission === 'unsupported' ? (
            <p className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground">
              <BellOff className="size-3" /> Push not supported in this browser
            </p>
          ) : (
            <Button variant="outline" size="sm" className="h-8 w-full justify-start text-xs" onClick={requestPush}>
              <BellRing className="mr-1.5 size-3" /> Enable push notifications
            </Button>
          )}
        </div>
      </DropdownMenuContent>

      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all notifications?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything in your notification list will be archived. This cannot be undone, but future notifications still arrive normally.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void clearAll() }}
              disabled={clearing}
            >
              {clearing ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Trash2 className="mr-1.5 size-4" />} Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DropdownMenu>
  )
}
