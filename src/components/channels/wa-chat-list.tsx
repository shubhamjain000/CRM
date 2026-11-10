'use client'

/**
 * WhatsApp live connector UI (FIX 3 + FIX 4)
 * ------------------------------------------
 * Extracted from views/channels.tsx to keep that file manageable. Contains:
 *  - useWaConnector  — 2.5s /status poll + connector actions
 *  - useWaChats      — 3s /chats poll (stale-while-revalidate, never blanks)
 *  - useWaConversation — per-peer /messages poll + send
 *  - WaConnectorCard — step-by-step linking flow (QR or phone-number pairing)
 *  - WaLockedCard    — read-only card for non-admin users
 *  - WaChatExperience— chat list + conversation (two panes on lg+, full-screen
 *                      conversation overlay on mobile), preserved across
 *                      disconnect↔reconnect flips
 *
 * All traffic goes through waApi() → the relative proxy
 * `/api/whatsapp/live/<sub>` (same helper the connector panel always used).
 */

import * as React from 'react'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Copy, Loader2, Lock, LogOut,
  MessageCircle, MessageSquareText, Plug, QrCode, RefreshCw, Send,
  Smartphone, Sparkles,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WaConnStatus = 'disconnected' | 'scanning' | 'connected' | 'error'
export type WaMode = 'real' | 'demo'

interface WaQrInfo { dataUrl: string; expiresInSec: number }
export interface WaStatusInfo {
  ok: boolean
  mode: WaMode
  status: WaConnStatus
  hasPersistedSession: boolean
  qr: WaQrInfo | null
  me: { phone: string; name: string } | null
  connectedAt: number | null
  /** FIX 3: true while post-connect history sync is streaming in. */
  syncingChats?: boolean
  /** FIX 3: number of chats in the persistent store. */
  chatCount?: number
  /** FIX 4: live pairing code (phone-number linking). */
  pairing?: { code: string; phoneNumber: string; expiresInSec: number } | null
  error?: string
}
export interface WaMessageItem {
  id: string
  from: string
  to: string
  text: string
  timestamp: number
  direction: 'in' | 'out'
}
export interface WaChatEntry {
  peer: string
  name: string
  lastMessage: string
  lastTimestamp: number
  unreadCount: number
  messageCount: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WA_SERVICE_PORT = '3010'

function waApi(path: string, init?: RequestInit): Promise<Response> {
  // `/wa/status` → `/api/whatsapp/live/status` (proxy preserves query strings)
  const sub = path.replace(/^\/+/, '')
  void WA_SERVICE_PORT
  return fetch(`/api/whatsapp/live/${sub}`, { cache: 'no-store', ...init })
}

function formatWaPhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '')
  return digits ? `+${digits}` : raw
}

/** Compact relative time for chat rows: now / 5m / 3h / 2d / Mon 12. */
function relTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return 'now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** 8-char pairing code → `XXXX XXXX`. */
function groupPairCode(code: string): string {
  const clean = code.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  return clean.replace(/(.{4})/g, '$1 ').trim()
}

function peerDigits(peer: string): string {
  return (peer.split('@')[0] ?? peer).replace(/[^0-9]/g, '')
}

function chatDisplayName(c: WaChatEntry | null, peer: string): string {
  return c?.name?.trim() || formatWaPhone(peerDigits(peer))
}

const WA_STATUS_META: Record<WaConnStatus, { label: string; dot: string; text: string }> = {
  connected: { label: 'Connected', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  scanning: { label: 'Linking — waiting for QR scan', dot: 'bg-amber-500 animate-pulse', text: 'text-amber-600 dark:text-amber-400' },
  disconnected: { label: 'Disconnected', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  error: { label: 'Error', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
}

function WaStatusLine({ status, unreachable }: { status: WaStatusInfo | null; unreachable: boolean }) {
  // The in-app proxy reports `status: 'unreachable'` when the connector service
  // is down — fall back to the disconnected meta so an unknown value can never
  // crash the status line.
  const meta = unreachable
    ? { label: 'Connector service unreachable', dot: 'bg-red-500 animate-pulse', text: 'text-red-600 dark:text-red-400' }
    : WA_STATUS_META[status?.status ?? 'disconnected'] ?? WA_STATUS_META.disconnected
  const mode = status?.mode
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-full ${meta.dot}`} />
      <span className={`font-medium ${meta.text}`}>{meta.label}</span>
      {mode && (
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
          {mode === 'demo' ? 'Demo' : 'Live'}
        </Badge>
      )}
      {status?.me?.phone && <span className="text-muted-foreground">· {formatWaPhone(status.me.phone)}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface WaConnector {
  status: WaStatusInfo | null
  unreachable: boolean
  pending: string | null
  start: () => void
  refreshQr: () => void
  demoConnect: () => void
  disconnect: () => void
}

/** Polls GET /status every 2.5s and exposes the connector actions. */
export function useWaConnector(): WaConnector {
  const [status, setStatus] = React.useState<WaStatusInfo | null>(null)
  const [unreachable, setUnreachable] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)

  const poll = React.useCallback(async () => {
    try {
      const res = await waApi('/wa/status')
      const data = await res.json() as WaStatusInfo | null
      if (data && typeof data.status === 'string') {
        setStatus(data)
        setUnreachable(false)
      } else {
        setUnreachable(true)
      }
    } catch {
      setUnreachable(true) // keep the last snapshot; the next poll retries
    }
  }, [])

  React.useEffect(() => {
    void poll()
    const t = setInterval(() => { void poll() }, 2500)
    return () => clearInterval(t)
  }, [poll])

  const act = React.useCallback(async (
    name: string,
    path: string,
    successToast: string,
    fallbackError: string,
  ) => {
    setPending(name)
    try {
      const res = await waApi(path, { method: 'POST' })
      const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (!res.ok || data?.ok === false) throw new Error(data?.error || fallbackError)
      toast.success(successToast)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : fallbackError)
    } finally {
      setPending(null)
      void poll()
    }
  }, [poll])

  return {
    status,
    unreachable,
    pending,
    start: () => void act('start', '/wa/start', 'Linking started — scan the QR with WhatsApp (Linked devices)', 'Failed to start linking'),
    refreshQr: () => void act('refresh-qr', '/wa/refresh-qr', 'Fresh QR generated — scan it now', 'Failed to refresh the QR code'),
    demoConnect: () => void act('demo-connect', '/wa/demo-connect', 'Demo WhatsApp session connected', 'Could not start the demo session'),
    disconnect: () => void act('disconnect', '/wa/disconnect', 'WhatsApp disconnected', 'Failed to disconnect'),
  }
}

export interface WaChatsState {
  chats: WaChatEntry[] | null
  /** Total unread messages across chats (0 when unknown). */
  totalUnread: number
  markRead: (peer: string) => void
  refresh: () => void
}

/**
 * Polls GET /chats every 3s while connected. Stale-while-revalidate: rows are
 * NEVER cleared on a failed/absent refresh — new data merges over the old.
 */
export function useWaChats(enabled: boolean): WaChatsState {
  const [chats, setChats] = React.useState<WaChatEntry[] | null>(null)
  // Peers we just marked read — keep the pill suppressed for a few seconds in
  // case the next poll races the POST /chats/read on the connector.
  const clearedRef = React.useRef<Map<string, number>>(new Map())

  const load = React.useCallback(async () => {
    try {
      const res = await waApi('/wa/chats?limit=100')
      const data = await res.json()
      if (!Array.isArray(data?.chats)) return
      const now = Date.now()
      const incoming = data.chats as WaChatEntry[]
      const merged = incoming.map((c) => {
        const clearedAt = clearedRef.current.get(c.peer)
        if (clearedAt && now - clearedAt < 6_000 && c.unreadCount > 0) return { ...c, unreadCount: 0 }
        if (c.unreadCount === 0) clearedRef.current.delete(c.peer)
        return c
      })
      setChats(merged)
    } catch { /* keep the previous rows — the list must never blank */ }
  }, [])

  React.useEffect(() => {
    if (!enabled) return
    void load()
    const t = setInterval(() => { void load() }, 3000)
    return () => clearInterval(t)
  }, [enabled, load])

  const markRead = React.useCallback((peer: string) => {
    clearedRef.current.set(peer, Date.now())
    setChats((cur) => (cur ? cur.map((c) => (c.peer === peer ? { ...c, unreadCount: 0 } : c)) : cur))
    void waApi('/wa/chats/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer }),
    }).catch(() => { /* the 3s poll will reconcile */ })
  }, [])

  const totalUnread = React.useMemo(
    () => (chats ?? []).reduce((n, c) => n + (c.unreadCount > 0 ? c.unreadCount : 0), 0),
    [chats],
  )

  return { chats, totalUnread, markRead, refresh: load }
}

interface WaConversationState {
  messages: WaMessageItem[] | null
  sending: boolean
  send: (text: string) => Promise<boolean>
}

/**
 * Polls GET /messages?peer=<jid> every 3s while the conversation is open and
 * the session is connected. Messages are preserved while refreshing; switching
 * peers resets the view exactly once.
 */
function useWaConversation(peer: string | null, enabled: boolean): WaConversationState {
  const [messages, setMessages] = React.useState<WaMessageItem[] | null>(null)
  const [sending, setSending] = React.useState(false)
  const prevPeerRef = React.useRef<string | null>(null)

  const load = React.useCallback(async () => {
    if (!peer) return
    try {
      const res = await waApi(`/wa/messages?peer=${encodeURIComponent(peer)}&limit=100`)
      const data = await res.json()
      if (Array.isArray(data?.messages)) setMessages(data.messages as WaMessageItem[])
    } catch { /* keep the last snapshot */ }
  }, [peer])

  React.useEffect(() => {
    if (!peer) return
    if (prevPeerRef.current !== peer) {
      prevPeerRef.current = peer
      setMessages(null)
    }
    if (!enabled) return
    void load()
    const t = setInterval(() => { void load() }, 3000)
    return () => clearInterval(t)
  }, [enabled, peer, load])

  const send = React.useCallback(async (text: string): Promise<boolean> => {
    if (!peer) return false
    setSending(true)
    try {
      const res = await waApi('/wa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: peer, text }),
      })
      const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Send failed')
      toast.success('Message sent')
      void load()
      // Refresh shortly after so the (echo) reply shows up fast.
      setTimeout(() => { void load() }, 1500)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed')
      return false
    } finally {
      setSending(false)
    }
  }, [peer, load])

  return { messages, sending, send }
}

// ---------------------------------------------------------------------------
// WaConnectorCard — step-by-step linking flow (FIX 4)
// ---------------------------------------------------------------------------

const COUNTRY_CODES = [
  { value: '+1', label: '+1 US / Canada' },
  { value: '+44', label: '+44 United Kingdom' },
  { value: '+91', label: '+91 India' },
  { value: '+971', label: '+971 UAE' },
  { value: '+65', label: '+65 Singapore' },
  { value: '+61', label: '+61 Australia' },
  { value: '+49', label: '+49 Germany' },
  { value: '+33', label: '+33 France' },
  { value: '+55', label: '+55 Brazil' },
  { value: '+27', label: '+27 South Africa' },
  { value: '+234', label: '+234 Nigeria' },
  { value: 'custom', label: 'Custom…' },
]

function StripStep({ label, state }: { label: string; state: 'active' | 'done' | 'idle' }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`inline-block size-2 shrink-0 rounded-full ${
          state === 'active' ? 'animate-pulse bg-amber-500' : state === 'done' ? 'bg-emerald-500' : 'bg-muted-foreground/30'
        }`}
      />
      <span className={state === 'active' ? 'font-medium text-foreground' : 'text-muted-foreground'}>{label}</span>
    </span>
  )
}

/** Live status strip: Waiting → Scanning/Pairing → Connected / Failed. */
function LinkStatusStrip({ status, method, onRetry, busy }: {
  status: WaStatusInfo | null
  method: 'none' | 'qr' | 'phone'
  onRetry: () => void
  busy: boolean
}) {
  const st = status?.status ?? 'disconnected'
  if (st === 'connected') return null
  const failed = st === 'error'
  const scanning = st === 'scanning'
  const step2Label = method === 'phone' ? 'Pairing' : 'Scanning'
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border px-3 py-2.5 text-xs ${
        failed ? 'border-red-500/40 bg-red-500/5' : 'bg-muted/30'
      }`}
      role="status"
      aria-live="polite"
    >
      {failed ? (
        <>
          <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full bg-red-500" />
          <span className="font-medium text-red-600 dark:text-red-400">Failed</span>
          {status?.error && <span className="min-w-0 flex-1 break-words text-muted-foreground">{status.error}</span>}
          <Button size="sm" variant="outline" className="ml-auto min-h-9 shrink-0" onClick={onRetry} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />} Try again
          </Button>
        </>
      ) : (
        <>
          <StripStep label={method === 'phone' ? 'Code requested' : 'Waiting for QR'} state={scanning ? 'done' : 'active'} />
          <span aria-hidden="true" className="text-muted-foreground/50">→</span>
          <StripStep label={step2Label} state={scanning ? 'active' : 'idle'} />
          <span aria-hidden="true" className="text-muted-foreground/50">→</span>
          <StripStep label="Connected" state="idle" />
        </>
      )}
    </div>
  )
}

export function WaConnectorCard({ wa, chats, onOpenChats }: {
  wa: WaConnector
  chats: WaChatsState
  onOpenChats: () => void
}) {
  const { status, unreachable, pending, start, refreshQr, demoConnect, disconnect } = wa
  const busy = pending !== null
  const connected = status?.status === 'connected'
  const st = status?.status ?? 'disconnected'

  const [method, setMethod] = React.useState<'none' | 'qr' | 'phone'>('none')
  const [cc, setCc] = React.useState('+1')
  const [customDial, setCustomDial] = React.useState('')
  const [national, setNational] = React.useState('')
  const [numberError, setNumberError] = React.useState<string | null>(null)
  const [pairBusy, setPairBusy] = React.useState(false)
  const [pairError, setPairError] = React.useState<string | null>(null)
  const [linked409, setLinked409] = React.useState<string | null>(null)
  const [disconnectOpen, setDisconnectOpen] = React.useState(false)
  const [switchOpen, setSwitchOpen] = React.useState(false)

  // --- QR expiry countdown (keyed on the dataUrl so polls don't reset it) ---
  const qr = status?.qr ?? null
  const [qrDeadline, setQrDeadline] = React.useState<number | null>(null)
  const [nowTick, setNowTick] = React.useState(Date.now())
  React.useEffect(() => {
    if (qr) setQrDeadline(Date.now() + Math.max(1, qr.expiresInSec) * 1000)
    else setQrDeadline(null)
  }, [qr?.dataUrl])
  React.useEffect(() => {
    if (!qr) return
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [qr?.dataUrl])
  const qrSecondsLeft = qrDeadline ? Math.max(0, Math.ceil((qrDeadline - nowTick) / 1000)) : 0

  // --- Pairing code countdown (keyed on the code) ---------------------------
  const pairing = status?.pairing ?? null
  const [pairDeadline, setPairDeadline] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (pairing) setPairDeadline(Date.now() + Math.max(1, pairing.expiresInSec) * 1000)
    else setPairDeadline(null)
  }, [pairing?.code])
  React.useEffect(() => {
    if (!pairing) return
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [pairing?.code])
  const pairSecondsLeft = pairDeadline ? Math.max(0, Math.ceil((pairDeadline - nowTick) / 1000)) : 0

  const backToMenu = () => {
    setMethod('none')
    setPairError(null)
    setLinked409(null)
    setNumberError(null)
  }

  const chooseQr = () => {
    setMethod('qr')
    setPairError(null)
    setLinked409(null)
    start()
  }

  const fullDigits = `${cc === 'custom' ? customDial : cc}${national}`.replace(/[^0-9]/g, '')

  const requestPair = React.useCallback(async () => {
    setNumberError(null)
    setPairError(null)
    setLinked409(null)
    const digits = `${cc === 'custom' ? customDial : cc}${national}`.replace(/[^0-9]/g, '')
    if (digits.length < 8 || digits.length > 15) {
      setNumberError('Enter a valid phone number with country code (8–15 digits).')
      return
    }
    setPairBusy(true)
    try {
      const res = await waApi('/wa/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: digits }),
      })
      const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (!res.ok || data?.ok === false) {
        const raw = data?.error || 'Failed to request a pairing code'
        // Network-level failures read as raw fetch errors — give users an
        // actionable message instead of browser jargon.
        const friendly = /fetch failed|network|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timed? ?out/i.test(raw)
          ? 'Could not reach WhatsApp to request a pairing code. Check your connection (or the connector service) and try again.'
          : raw
        if (res.status === 409) setLinked409(friendly)
        else setPairError(friendly)
        return
      }
      toast.success('Pairing code requested — enter it on your phone')
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to request a pairing code'
      setPairError(/fetch failed|network|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timed? ?out/i.test(raw)
        ? 'Could not reach the connector service to request a pairing code. Try again in a moment.'
        : raw)
    } finally {
      setPairBusy(false)
    }
  }, [cc, customDial, national])

  const copyPairCode = async () => {
    if (!pairing) return
    try {
      await navigator.clipboard.writeText(pairing.code)
      toast.success('Pairing code copied')
    } catch {
      toast.error('Copy failed — select the code manually')
    }
  }

  const retryLink = () => {
    if (method === 'phone') void requestPair()
    else start()
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <MessageCircle className="size-5" />
            </div>
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                WhatsApp live connector
                {connected && chats.totalUnread > 0 && (
                  <Badge className="border-transparent bg-emerald-500 text-white">{chats.totalUnread} unread</Badge>
                )}
              </CardTitle>
              <CardDescription>Link this workspace with a QR code or a phone number — messages flow in and out live.</CardDescription>
            </div>
          </div>
          {status?.hasPersistedSession && !connected && (
            <Badge variant="outline" className="text-[10px]">Saved session</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <WaStatusLine status={status} unreachable={unreachable} />

        {connected ? (
          /* ---- Step 4: success ------------------------------------------------ */
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                  <CheckCircle2 className="size-6" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">Connected as {formatWaPhone(status?.me?.phone ?? '')}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {status?.me?.name}
                    {status?.connectedAt ? ` · since ${new Date(status.connectedAt).toLocaleTimeString()}` : ''}
                  </p>
                </div>
              </div>
              {chats.totalUnread > 0 && (
                <Badge className="border-transparent bg-emerald-500 text-white sm:ml-auto">{chats.totalUnread} unread</Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={onOpenChats} className="min-h-11">
                <MessageCircle className="mr-1.5 size-4" /> Start Messaging
              </Button>
              <Button variant="outline" className="min-h-11" onClick={() => setSwitchOpen(true)} disabled={busy}>
                Switch Number
              </Button>
              <Button
                variant="outline"
                className="min-h-11 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDisconnectOpen(true)}
                disabled={busy}
              >
                {pending === 'disconnect' ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <LogOut className="mr-1.5 size-4" />} Disconnect
              </Button>
            </div>
          </div>
        ) : method === 'none' ? (
          /* ---- Step 1: choose a method --------------------------------------- */
          <div className="space-y-3">
            <p className="text-sm font-medium">Connect WhatsApp</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={chooseQr}
                className="flex min-h-[104px] flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                  <QrCode className="size-5" />
                </span>
                <span className="flex items-center gap-2 text-sm font-medium">
                  QR Code
                  <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Recommended</Badge>
                </span>
                <span className="text-xs text-muted-foreground">Scan with your phone camera — the fastest way to link.</span>
              </button>
              <button
                type="button"
                onClick={() => { setMethod('phone'); setPairError(null); setLinked409(null) }}
                className="flex min-h-[104px] flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                  <Smartphone className="size-5" />
                </span>
                <span className="text-sm font-medium">Phone Number</span>
                <span className="text-xs text-muted-foreground">Enter your number and type an 8-character code on the phone.</span>
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {status?.hasPersistedSession && st === 'disconnected' && (
                <Button onClick={start} disabled={busy} className="min-h-11">
                  {pending === 'start' ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Plug className="mr-1.5 size-4" />} Reconnect saved session
                </Button>
              )}
              <Button variant="outline" onClick={demoConnect} disabled={busy} className="min-h-11" title="Fake a connected WhatsApp session to try the chat UI without external network">
                {pending === 'demo-connect' ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Sparkles className="mr-1.5 size-4" />} Demo connect (sandbox)
              </Button>
            </div>
          </div>
        ) : method === 'qr' ? (
          /* ---- Step 2a: QR ---------------------------------------------------- */
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium"><QrCode className="size-4" /> Scan with WhatsApp</p>
              <Button variant="ghost" size="sm" className="min-h-9" onClick={backToMenu}>← Other ways to connect</Button>
            </div>
            {st === 'scanning' && qr ? (
              <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-4 sm:flex-row sm:items-start">
                <img src={qr.dataUrl} alt="WhatsApp QR code" className="size-44 shrink-0 rounded-md border bg-white p-1 sm:size-48" />
                <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
                  <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
                    <li>Open WhatsApp on your phone</li>
                    <li>Tap <span className="font-medium text-foreground">Settings → Linked devices</span></li>
                    <li>Tap <span className="font-medium text-foreground">Link a device</span> and scan this QR</li>
                  </ol>
                  <p className={`text-xs font-medium ${qrSecondsLeft > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-destructive'}`}>
                    {qrSecondsLeft > 0 ? `QR expires in ~${qrSecondsLeft}s` : 'QR expired — tap Refresh QR for a new one.'}
                  </p>
                  <Button variant="outline" onClick={refreshQr} disabled={busy} className="min-h-11" aria-label="Refresh the WhatsApp QR code">
                    {pending === 'refresh-qr' ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />} Refresh QR
                  </Button>
                </div>
              </div>
            ) : st === 'scanning' ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Waiting for the QR code to appear…
              </p>
            ) : st === 'error' ? (
              <p className="text-xs text-muted-foreground">Linking failed — see the status strip below, or go back to pick another method.</p>
            ) : (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Starting the link session…
              </p>
            )}
          </div>
        ) : (
          /* ---- Step 2b: phone-number pairing ---------------------------------- */
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium"><Smartphone className="size-4" /> Link with phone number</p>
              <Button variant="ghost" size="sm" className="min-h-9" onClick={backToMenu}>← Other ways to connect</Button>
            </div>

            {linked409 && (
              <Alert className="border-amber-500/40">
                <AlertTriangle className="size-4 shrink-0" />
                <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                  <span className="min-w-0 flex-1 break-words">{linked409}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9 shrink-0"
                    onClick={() => { setLinked409(null); disconnect() }}
                  >
                    Disconnect and relink
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {pairing && pairSecondsLeft > 0 ? (
              <div className="space-y-3 rounded-lg border border-dashed p-4">
                <p className="text-xs text-muted-foreground">
                  On your phone: WhatsApp → Settings → Linked devices → Link a device →{' '}
                  <span className="font-medium text-foreground">Link with phone number instead</span>, then enter:
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                  <p className="font-mono text-3xl font-bold tracking-[0.3em] text-foreground sm:text-4xl" aria-label={`Pairing code ${pairing.code}`}>
                    {groupPairCode(pairing.code)}
                  </p>
                  <Button size="icon" variant="outline" className="size-11 shrink-0" onClick={copyPairCode} aria-label="Copy pairing code">
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  Code expires in ~{pairSecondsLeft}s · pairing {formatWaPhone(pairing.phoneNumber)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Keep this screen open — the session connects automatically once the code is accepted.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                  <div className="space-y-1.5">
                    <Label>Country code</Label>
                    <Select value={cc} onValueChange={(v) => { setCc(v); setNumberError(null) }}>
                      <SelectTrigger className="min-h-11 w-full" aria-label="Country code"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COUNTRY_CODES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wa-pair-national">National number</Label>
                    <Input
                      id="wa-pair-national"
                      inputMode="tel"
                      autoComplete="tel-national"
                      value={national}
                      onChange={(e) => { setNational(e.target.value.replace(/[^0-9\s-]/g, '')); setNumberError(null) }}
                      placeholder="98765 43210"
                      className="min-h-11"
                      aria-invalid={!!numberError}
                      aria-describedby={numberError ? 'wa-pair-error' : undefined}
                    />
                  </div>
                </div>
                {cc === 'custom' && (
                  <div className="space-y-1.5 sm:max-w-[240px]">
                    <Label htmlFor="wa-pair-dial">Dial code</Label>
                    <Input
                      id="wa-pair-dial"
                      inputMode="tel"
                      value={customDial}
                      onChange={(e) => { setCustomDial(e.target.value.replace(/[^0-9+]/g, '')); setNumberError(null) }}
                      placeholder="+61"
                      className="min-h-11"
                    />
                  </div>
                )}
                {numberError && <p id="wa-pair-error" className="text-xs text-destructive">{numberError}</p>}
                {pairError && (
                  <Alert className="border-destructive/40">
                    <AlertTriangle className="size-4 shrink-0" />
                    <AlertDescription className="break-words text-xs">{pairError}</AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void requestPair()} disabled={pairBusy || !national.trim()} className="min-h-11">
                    {pairBusy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Smartphone className="mr-1.5 size-4" />}
                    {pairBusy ? 'Requesting code…' : 'Request pairing code'}
                  </Button>
                  {pairing && pairSecondsLeft <= 0 && (
                    <Button variant="outline" className="min-h-11" onClick={() => void requestPair()} disabled={pairBusy}>
                      <RefreshCw className="mr-1.5 size-4" /> Request new code
                    </Button>
                  )}
                </div>
                {st === 'scanning' && !pairing && !pairBusy && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Reaching WhatsApp servers — the code appears here automatically.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---- Step 3: live status strip (always visible while linking) ------- */}
        {!connected && method !== 'none' && (
          <LinkStatusStrip status={status} method={method} onRetry={retryLink} busy={busy || pairBusy} />
        )}
      </CardContent>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              The linked device will be logged out and the saved session removed{status?.mode === 'demo' ? ' (this also ends the demo session)' : ''}. You can connect again anytime with a fresh QR scan or pairing code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setDisconnectOpen(false); disconnect(); setMethod('none') }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={switchOpen} onOpenChange={setSwitchOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to a different number?</AlertDialogTitle>
            <AlertDialogDescription>This disconnects the current session. The linked device will be logged out and you return to the connect options.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setSwitchOpen(false); disconnect(); setMethod('none') }}
            >
              Disconnect and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// WaLockedCard — read-only for non-admin users
// ---------------------------------------------------------------------------

export function WaLockedCard({ status, unreachable }: { status: WaStatusInfo | null; unreachable: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
            <MessageCircle className="size-5" />
          </div>
          <div>
            <CardTitle className="text-base">WhatsApp live connector</CardTitle>
            <CardDescription>Link this workspace to WhatsApp with a QR code or phone number.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <WaStatusLine status={status} unreachable={unreachable} />
        <Alert>
          <Lock className="size-4 shrink-0" />
          <AlertDescription className="text-xs">
            Connector management is available to Admin users only. The connection status above is read-only.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// WaChatExperience — chat list + conversation (FIX 3)
// ---------------------------------------------------------------------------

function ChatListRow({ chat, active, onOpen }: { chat: WaChatEntry; active: boolean; onOpen: () => void }) {
  const name = chatDisplayName(chat, chat.peer)
  const initial = (name.replace(/[^A-Za-z0-9]/g, '')[0] ?? '#').toUpperCase()
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
      className={`flex min-h-16 w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/60 ${
        active ? 'bg-muted/60' : ''
      }`}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
        {initial}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{relTime(chat.lastTimestamp)}</span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">{chat.lastMessage || 'No messages yet'}</span>
          {chat.unreadCount > 0 && (
            <Badge className="shrink-0 border-transparent bg-emerald-500 text-white tabular-nums">
              {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
            </Badge>
          )}
        </span>
      </span>
    </button>
  )
}

function ConversationPane({ chat, peer, conv, onBack, connected, mode }: {
  chat: WaChatEntry | null
  peer: string
  conv: WaConversationState
  onBack: () => void
  connected: boolean
  mode?: WaMode
}) {
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [text, setText] = React.useState('')
  const chronological = React.useMemo(
    () => (conv.messages ? [...conv.messages].sort((a, b) => a.timestamp - b.timestamp) : null),
    [conv.messages],
  )

  React.useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chronological?.length, peer])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || conv.sending) return
    const ok = await conv.send(body)
    if (ok) setText('')
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background lg:static lg:z-auto">
      {/* Header — doubles as the mobile full-screen sticky bar */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur lg:px-4">
        <Button variant="ghost" size="icon" className="size-10 shrink-0 lg:hidden" onClick={onBack} aria-label="Back to chats">
          <ArrowLeft className="size-5" />
        </Button>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          {(chatDisplayName(chat, peer).replace(/[^A-Za-z0-9]/g, '')[0] ?? '#').toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{chatDisplayName(chat, peer)}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {formatWaPhone(peerDigits(peer))}
            {connected ? '' : ' · offline'}
          </p>
        </div>
        {mode === 'demo' && <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">Demo</Badge>}
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        aria-live="polite"
        className="[scrollbar-width:thin] min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/20 p-3 lg:max-h-[520px] lg:min-h-[300px] lg:flex-none lg:p-4"
      >
        {chronological === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className={`h-10 ${i % 2 ? 'ml-auto w-2/3' : 'w-1/2'}`} />
            ))}
          </div>
        ) : chronological.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No messages in this chat yet</p>
        ) : (
          chronological.map((m) => (
            <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm sm:max-w-[75%] ${
                  m.direction === 'out' ? 'bg-primary text-primary-foreground' : 'border bg-background text-foreground'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className={`mt-0.5 text-right text-[10px] ${m.direction === 'out' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                  {m.direction === 'out' ? 'You' : chatDisplayName(chat, peer)} · {new Date(m.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <form className="flex items-center gap-2 border-t p-3 lg:p-4" onSubmit={submit}>
        <Label htmlFor="wa-conv-text" className="sr-only">Message</Label>
        <Input
          id="wa-conv-text"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={connected ? 'Type a message' : 'Offline — reconnect to send'}
          disabled={!connected}
          className="min-h-11 flex-1"
          aria-label="Message text"
        />
        <Button
          type="submit"
          size="icon"
          className="size-11 shrink-0"
          disabled={!connected || conv.sending || !text.trim()}
          aria-label="Send message"
        >
          {conv.sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>
    </div>
  )
}

export function WaChatExperience({ wa, chats, mode }: {
  wa: WaConnector
  chats: WaChatsState
  mode?: WaMode
}) {
  const { status } = wa
  const connected = status?.status === 'connected'
  const [activePeer, setActivePeer] = React.useState<string | null>(null)
  const conv = useWaConversation(activePeer, Boolean(connected && activePeer))
  const rows = chats.chats
  const activeChat = rows?.find((c) => c.peer === activePeer) ?? null
  const syncing = Boolean(status?.syncingChats)
  const showReconnectBar = Boolean(status && status.status !== 'connected')

  const openChat = (peer: string) => {
    setActivePeer(peer)
    chats.markRead(peer)
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              WhatsApp chats
              {chats.totalUnread > 0 && (
                <Badge className="border-transparent bg-emerald-500 text-white">{chats.totalUnread} unread</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Live conversations for the connected session{mode === 'demo' ? ' (demo data)' : ''}. Click a chat to read and reply.
            </CardDescription>
          </div>
          {mode === 'demo' && <Badge variant="outline" className="text-[10px] uppercase tracking-wide">Demo data</Badge>}
        </div>
      </CardHeader>
      <CardContent className="p-0 pt-0">
        {/* Preserve-on-reconnect: the card stays mounted across status flips. */}
        {showReconnectBar && (
          <div className="flex items-center gap-2 border-b bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-400" role="status">
            <span aria-hidden="true" className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
            <span className="min-w-0 break-words">
              {status?.status === 'error' && status.error
                ? `Connection lost — ${status.error}`
                : 'Reconnecting… chats are kept and resume automatically.'}
            </span>
          </div>
        )}

        <div className="grid lg:grid-cols-[minmax(280px,360px)_1fr] lg:divide-x">
          {/* LEFT pane — chat list (hidden on mobile while a chat is open) */}
          <div className={activePeer ? 'hidden lg:block' : 'block'}>
            {syncing && (
              <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground" role="status">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                <span className="min-w-0 break-words">
                  Syncing chats…{status?.chatCount ? ` (${status.chatCount} so far)` : ''}
                </span>
              </div>
            )}
            <div className="[scrollbar-width:thin] max-h-[420px] overflow-y-auto lg:max-h-[560px]">
              {rows === null ? (
                <div className="p-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="mb-2 h-16 w-full" />)}
                </div>
              ) : rows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <MessageSquareText className="size-5" />
                  </div>
                  <p className="text-sm font-medium">No conversations yet</p>
                  <p className="text-xs text-muted-foreground">
                    Chats appear automatically when contacts message you{syncing ? ' or when history sync finishes' : ''}.
                  </p>
                </div>
              ) : (
                rows.map((c) => (
                  <ChatListRow key={c.peer} chat={c} active={c.peer === activePeer} onOpen={() => openChat(c.peer)} />
                ))
              )}
            </div>
          </div>

          {/* RIGHT pane — conversation (lg+) / full-screen overlay (mobile) */}
          <div className={activePeer ? 'block' : 'hidden lg:block'}>
            {activePeer ? (
              <ConversationPane
                chat={activeChat}
                peer={activePeer}
                conv={conv}
                onBack={() => setActivePeer(null)}
                connected={connected}
                mode={mode}
              />
            ) : (
              <div className="hidden min-h-[320px] flex-col items-center justify-center gap-2 p-8 text-center lg:flex">
                <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <MessageSquareText className="size-6" />
                </div>
                <p className="text-sm font-medium">Select a chat</p>
                <p className="max-w-[260px] text-xs text-muted-foreground">
                  Pick a conversation on the left to read messages and reply from here.
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
