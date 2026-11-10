'use client'

import * as React from 'react'
import { AtSign, Bell, CheckSquare, MessageSquare, X } from 'lucide-react'
import { useRealtime } from '@/components/productivity/realtime-provider'
import { toast } from 'sonner'
import { dispatchNotificationNavigate, notificationMessage, verbGroup } from './notification-shared'

/**
 * Mobile notification banner — real-time notifications surface as a fixed
 * banner at the TOP of the viewport on phones (never buried behind the
 * navbar). Desktop keeps sonner toasts (handled by the bell), so the visual
 * banner is `lg:hidden`; the browser-push logic below runs on ALL sizes.
 */

interface BannerItem {
  key: string
  title: string
  body: string | null
  notification: Parameters<typeof dispatchNotificationNavigate>[0]
}

const GROUP_ICON = {
  mentions: AtSign,
  tasks: CheckSquare,
  messages: MessageSquare,
  system: Bell,
} as const

export function NotificationBanner() {
  const realtime = useRealtime()
  const [banner, setBanner] = React.useState<BannerItem | null>(null)
  const [leaving, setLeaving] = React.useState(false)
  const seenId = React.useRef<string | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = React.useCallback(() => {
    setLeaving(true)
    setTimeout(() => { setBanner(null); setLeaving(false) }, 200)
  }, [])

  // Auto-dismiss after 6s (cleared whenever the banner changes).
  React.useEffect(() => {
    if (!banner) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(dismiss, 6000)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [banner, dismiss])

  React.useEffect(() => {
    if (!realtime) return
    const latest = realtime.notifications.find((n) => n.event === 'notification')
    if (!latest || latest.id === seenId.current) return
    seenId.current = latest.id
    const data = (latest.data ?? {}) as {
      id?: string; verb?: string; message?: string; targetName?: string; targetModule?: string; targetId?: string
    }
    const message = data.message ?? data.targetName ?? null
    const verb = data.verb ?? 'notification'
    const item: BannerItem = {
      key: data.id ?? latest.id,
      title: message || verbLabel(verb),
      body: message ? (data.targetName ?? null) : null,
      notification: {
        id: data.id ?? latest.id,
        verb,
        targetModule: data.targetModule ?? null,
        targetId: data.targetId ?? null,
        targetName: data.targetName ?? null,
        createdAt: new Date().toISOString(),
      },
    }
    setBanner(item)
    maybeBrowserPush(item)
  }, [realtime])

  const onTap = () => {
    if (!banner) return
    const ok = dispatchNotificationNavigate(banner.notification)
    if (!ok) toast.info(banner.title, { description: 'No destination for this notification' })
    dismiss()
  }

  if (!banner) return null
  const Icon = GROUP_ICON[verbGroup(banner.notification.verb)]
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-[60] lg:hidden ${leaving ? 'notif-banner-out' : 'notif-banner-in'}`}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Keyframes are injected here so the banner stays fully self-contained. */}
      <style>{`
        @keyframes notif-banner-in { from { opacity: 0; transform: translateY(-100%); } to { opacity: 1; transform: none; } }
        @keyframes notif-banner-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-100%); } }
        .notif-banner-in { animation: notif-banner-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both; }
        .notif-banner-out { animation: notif-banner-out 200ms ease-in both; }
        @media (prefers-reduced-motion: reduce) { .notif-banner-in, .notif-banner-out { animation: none; } }
      `}</style>
      <button
        type="button"
        onClick={onTap}
        className="relative flex min-h-11 w-full items-start gap-3 border-b bg-card/95 px-4 py-3 text-left shadow-lg backdrop-blur"
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{banner.title}</span>
          {banner.body && <span className="block truncate text-xs text-muted-foreground">{banner.body}</span>}
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label="Dismiss notification"
          className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
          onClick={(e) => { e.stopPropagation(); dismiss() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); dismiss() } }}
        >
          <X className="size-4" aria-hidden />
        </span>
      </button>
    </div>
  )
}

function verbLabel(verb: string): string {
  return verb.replace(/[_-]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Web Push: fire a system notification for granted permission + hidden tab. */
function maybeBrowserPush(item: BannerItem) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted' || !document.hidden) return
    const n = new Notification(item.title, {
      body: item.body ?? undefined,
      icon: '/icons/icon-192.png',
      tag: item.key,
    })
    n.onclick = () => {
      try {
        window.focus()
        dispatchNotificationNavigate(item.notification)
      } catch { /* ignore focus errors */ }
    }
  } catch {
    // Unsupported browsers / SW registration issues — banner + toast still work.
  }
}
