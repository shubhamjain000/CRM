'use client'

// Tap-to-call + automatic call logging (outbound AND inbound).
//
// PhoneLink renders phone numbers as native `tel:` links (opens the iPhone
// dialer automatically) and stashes call context. CallTracker is mounted
// once at app root and handles both directions:
//
//  • Outbound — when the user returns from the native dialer the wall-clock
//    seconds are measured and the call AUTO-SAVES: dials that cross 10s are
//    "connected" and their talk time counts FROM THE CONNECT (the first 10s
//    of the dial are the ring and are NOT counted); 5–9s attempts log as
//    "no answer" with zero talk time. A slim confirmation banner offers a
//    Review button to correct duration/outcome/notes.
//
//  • Inbound — a browser cannot hear the phone ring, but on iPhone an
//    answered call backgrounds the tab. If the user returns after a long
//    enough absence with no outbound dial in flight, a one-tap "log incoming
//    call" prompt appears with the away time pre-filled and CRM caller
//    matching (contact/lead by phone or name).

import * as React from 'react'
import {
  PhoneCall, PhoneOutgoing, PhoneIncoming, X, Loader2, CheckCircle2, AlertTriangle, Search,
  PhoneForwarded,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import {
  CALL_LOGGED_EVENT, CALL_STARTED_EVENT, clearHiddenAt, clearOutboundCooldown,
  clearPendingCall, CONNECTED_CALL_SECONDS, formatDuration, formatDurationLabel,
  INBOUND_PROMPT_MIN_SECONDS, markOutboundCooldown, markPendingCallHidden,
  markTabHidden, MAX_INBOUND_WINDOW_SECONDS, MIN_CALL_SECONDS, parseDurationInput,
  pendingElapsedSeconds, readHiddenAt, readOutboundCooldown, readPendingCall,
  splitCallPhases, startCallTracking, telHref, type PendingCall,
} from '@/lib/call-tracking'
import { useAuth } from '@/store/auth'
import { CallTransferDialog } from '@/components/productivity/call-transfer-dialog'

// ---------------------------------------------------------------------------
// PhoneLink — renders a phone number as a native dialer link
// ---------------------------------------------------------------------------

interface PhoneLinkProps {
  phone: string
  /** Contact/lead display name for the log. */
  name?: string
  /** CRM module for linking the log ('contact' | 'lead' | 'account' …). */
  module?: string
  /** Related CRM record id. */
  recordId?: string
  className?: string
}

export function PhoneLink({ phone, name, module, recordId, className }: PhoneLinkProps) {
  const onDial = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Stash context synchronously BEFORE the tel: navigation — localStorage
    // writes survive iOS backgrounding. Do not preventDefault: the browser
    // must open the native dialer itself.
    try { e.stopPropagation() } catch { /* row click passthrough fine */ }
    startCallTracking({ toNumber: phone, name, module, recordId })
  }
  return (
    <a
      href={telHref(phone)}
      onClick={onDial}
      className={`inline-flex items-center gap-1 font-mono text-xs hover:text-primary hover:underline ${className ?? 'text-foreground'}`}
      aria-label={`Call ${name || phone} — opens phone dialer`}
      title={`Call ${phone}`}
    >
      <PhoneCall className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span>{phone}</span>
    </a>
  )
}

/** Renders the first phone from the JSON-encoded phones column, or '—'. */
export function PhonesCell({
  phonesJson, name, module, recordId,
}: { phonesJson: string; name: string; module: string; recordId: string }) {
  const phones = React.useMemo(() => {
    try {
      const parsed = JSON.parse(phonesJson)
      return Array.isArray(parsed) ? (parsed.filter((p) => typeof p === 'string' && p.trim()) as string[]) : []
    } catch {
      return []
    }
  }, [phonesJson])
  if (phones.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  return <PhoneLink phone={phones[0]} name={name} module={module} recordId={recordId} />
}

/**
 * A real Call button for list rows — one on EVERY row (disabled with a
 * "No phone" hint when the record has no number). Starts call tracking so
 * the dialer return auto-logs the call, then hands off to the native dialer.
 */
export function CallButton({
  phone, name, module, recordId, className,
}: {
  phone?: string | null
  name?: string
  module?: string
  recordId?: string
  className?: string
}) {
  const has = !!phone && phone.trim().length > 0
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!has}
      className={`h-7 max-w-full gap-1.5 px-2 text-xs ${className ?? ''}`}
      title={has ? `Call ${phone}` : 'No phone number on this record'}
      aria-label={has ? `Call ${name || phone} — opens phone dialer` : 'No phone number on this record'}
      onClick={(e) => {
        e.stopPropagation()
        if (!has) return
        startCallTracking({ toNumber: phone, name, module, recordId })
        window.location.assign(telHref(phone))
      }}
    >
      <PhoneCall className="size-3 shrink-0" aria-hidden />
      <span className="truncate font-mono">{has ? phone : <span className="text-muted-foreground">No phone</span>}</span>
    </Button>
  )
}

// ---------------------------------------------------------------------------
// CallTracker — auto-logging on dialer return (mount once at app root)
// ---------------------------------------------------------------------------

const OUTCOMES = [
  { value: 'connected', label: 'Connected' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'busy', label: 'Busy' },
] as const

const INBOUND_OUTCOMES = [
  { value: 'connected', label: 'Connected — spoke with them' },
  { value: 'no_answer', label: 'Missed — did not pick up' },
] as const

interface LoggedCall {
  callId: string
  name: string
  toNumber: string
  /** Stored duration — talk time for connected calls, dial span for attempts. */
  seconds: number
  /** Total wall-clock seconds from dialer open to return (for context hints). */
  elapsed: number
  outcome: string
  startedAt: number
  notes: string
}

interface FailedCall {
  pending: PendingCall
  /** Total wall-clock seconds from dialer open to return. */
  elapsed: number
}

interface InboundPrompt {
  hiddenAt: number
  hiddenSeconds: number
}

interface CallerMatch {
  module: 'contact' | 'lead'
  id: string
  name: string
  phone: string
  extra: string | null
}

const OUTCOME_LABEL: Record<string, string> = {
  connected: 'Connected',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  busy: 'Busy',
}

export function CallTracker() {
  const { permissions } = useAuth()
  // Call transfer is admin-only (owners resolve to admin via the `*` wildcard).
  const canTransfer = permissions.includes('org.admin') || permissions.includes('*')
  const [logged, setLogged] = React.useState<LoggedCall | null>(null)
  const [failed, setFailed] = React.useState<FailedCall | null>(null)
  const [inbound, setInbound] = React.useState<InboundPrompt | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [reviewOpen, setReviewOpen] = React.useState(false)
  const [inboundOpen, setInboundOpen] = React.useState(false)
  // Admin-only call transfer dialog, opened from the auto-log banner.
  const [transferOpen, setTransferOpen] = React.useState(false)
  // Review dialog state (frozen at open time)
  const [durationInput, setDurationInput] = React.useState('')
  const [outcome, setOutcome] = React.useState('connected')
  const [notes, setNotes] = React.useState('')
  // Inbound dialog state
  const [callerQuery, setCallerQuery] = React.useState('')
  const [matches, setMatches] = React.useState<CallerMatch[] | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [selected, setSelected] = React.useState<CallerMatch | null>(null)
  const [inboundPhone, setInboundPhone] = React.useState('')
  const [inboundDuration, setInboundDuration] = React.useState('')
  const [inboundOutcome, setInboundOutcome] = React.useState('connected')
  // Guards against duplicate auto-saves from overlapping visibility events.
  const autoLogInFlight = React.useRef(false)

  // --- visibility tracking (iPhone: tab hidden while native dialer open) ---
  React.useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        markPendingCallHidden()
        markTabHidden()
      }
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onHidden)
    }
  }, [])

  const autoLog = React.useCallback(async (pending: PendingCall, elapsed: number) => {
    // Phase model: the first CONNECTED_CALL_SECONDS of the dial are the ring —
    // talk time only starts once the call connects (dial + 10s).
    const phases = splitCallPhases(elapsed)
    const connected = phases.phase === 'connected'
    const outcome = connected ? 'connected' : 'no_answer'
    // Connected calls are logged from the CONNECT moment: startedAt = dial +
    // ring, duration = talk time. Attempts keep the whole dial span.
    const startedAtMs = connected ? pending.startedAt + phases.ringSeconds * 1000 : pending.startedAt
    const endedAtMs = pending.startedAt + elapsed * 1000
    const duration = connected ? phases.talkSeconds : elapsed
    setSaving(true)
    try {
      const res = await fetch('/api/productivity/calls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: pending.name
            ? `Call — ${pending.name} (${pending.toNumber})`
            : `Call — ${pending.toNumber}`,
          callType: 'outbound',
          outcome,
          duration,
          relatedModule: pending.module ?? undefined,
          relatedId: pending.recordId ?? undefined,
          startedAt: new Date(startedAtMs).toISOString(),
          endedAt: new Date(endedAtMs).toISOString(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Failed to log call (${res.status})`)
      }
      const data = (await res.json()) as { id: string }
      const entry: LoggedCall = {
        callId: data.id, name: pending.name, toNumber: pending.toNumber,
        seconds: duration, elapsed, outcome, startedAt: startedAtMs, notes: '',
      }
      setLogged(entry)
      // Views (Calls, dashboards) refresh their numbers on this event; open
      // detail views use detail.relatedModule/relatedId to match their record.
      window.dispatchEvent(new CustomEvent(CALL_LOGGED_EVENT, {
        detail: { relatedModule: pending.module ?? null, relatedId: pending.recordId ?? null },
      }))
      // Name + number together so the toast matches the banner.
      const whoLabel = pending.name
        ? `${pending.name} · ${pending.toNumber}`
        : pending.toNumber
      if (connected) {
        toast.success(`Call auto-logged · talk ${formatDurationLabel(phases.talkSeconds)}`, {
          description: `${whoLabel} — connected · time counted from connect (first ${CONNECTED_CALL_SECONDS}s ring excluded)`,
        })
      } else {
        toast(`Attempt logged · ${elapsed}s`, {
          description: `${whoLabel} — no answer, never connected (under ${CONNECTED_CALL_SECONDS}s)`,
        })
      }
    } catch {
      // Keep the payload so the banner offers a one-tap retry.
      setFailed({ pending, elapsed })
      toast.error('Could not auto-log the call', {
        description: 'Tap Retry on the banner to save it.',
      })
    } finally {
      setSaving(false)
    }
  }, [])

  // Re-evaluate on tab-visible / load:
  //  1. outbound dial pending + really opened (wasHidden) + lasted long
  //     enough → auto-log instantly;
  //  2. otherwise, a long absence with no dial in flight → incoming-call
  //     prompt (iPhone backgrounds the tab when a call is answered).
  const evaluate = React.useCallback(() => {
    if (autoLogInFlight.current) return
    const p = readPendingCall()
    if (p) {
      const elapsed = pendingElapsedSeconds(p)
      if (p.wasHidden && elapsed >= MIN_CALL_SECONDS) {
        // Clear BEFORE the async save so repeat visibility events can't double-log.
        // Start the post-outbound cooldown so the SAME call episode can't also
        // trigger a follow-up "Were you on a call?" inbound prompt (user briefly
        // backgrounding the tab after hanging up must not be misread as a new
        // incoming call).
        autoLogInFlight.current = true
        clearHiddenAt()
        clearPendingCall()
        markOutboundCooldown()
        setInbound(null)
        void autoLog(p, elapsed).finally(() => { autoLogInFlight.current = false })
      }
      return
    }
    // No outbound dial in flight — was the user away on a call?
    const hiddenAt = readHiddenAt()
    if (!hiddenAt) return
    clearHiddenAt() // consume: prompt at most once per absence
    // Same-call guard: if we just finished an outbound call, this absence is the
    // hang-up/tab-switch tail of THAT call, not a separate incoming call.
    if (readOutboundCooldown()) return
    const awaySeconds = Math.floor((Date.now() - hiddenAt) / 1000)
    if (awaySeconds >= INBOUND_PROMPT_MIN_SECONDS && awaySeconds <= MAX_INBOUND_WINDOW_SECONDS) {
      setInbound({ hiddenAt, hiddenSeconds: awaySeconds })
    }
  }, [autoLog])

  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') evaluate()
    }
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) evaluate() }
    // A fresh dial tap overwrites the pending context — re-evaluate to keep
    // the state machine consistent (and drop a stale inbound prompt). Also
    // clear any stale outbound banner from the PREVIOUS call so the new call
    // isn't visually mixed with the old one, and lift the inbound cooldown so
    // the new call's own completion can set a fresh one.
    const onCallStarted = () => {
      setLogged(null)
      setFailed(null)
      setInbound(null)
      clearOutboundCooldown()
      evaluate()
    }
    evaluate()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onShow)
    window.addEventListener(CALL_STARTED_EVENT, onCallStarted)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener(CALL_STARTED_EVENT, onCallStarted)
    }
  }, [evaluate])

  // Auto-dismiss the confirmation banner after a minute — the call stays in
  // the history either way.
  React.useEffect(() => {
    if (!logged || reviewOpen) return
    const t = window.setTimeout(() => setLogged(null), 60_000)
    return () => window.clearTimeout(t)
  }, [logged, reviewOpen])

  const openReview = () => {
    if (!logged) return
    setDurationInput(formatDuration(logged.seconds))
    setOutcome(logged.outcome)
    setNotes(logged.notes)
    setReviewOpen(true)
  }

  const retry = () => {
    const f = failed
    if (!f) return
    setFailed(null)
    autoLogInFlight.current = true
    clearPendingCall()
    void autoLog(f.pending, f.elapsed).finally(() => { autoLogInFlight.current = false })
  }

  const saveReview = async () => {
    if (!logged) return
    const seconds = parseDurationInput(durationInput)
    if (seconds === null) {
      toast.error('Enter duration as m:ss (e.g. 2:45) or seconds')
      return
    }
    setSaving(true)
    try {
      const endedAt = new Date(logged.startedAt + seconds * 1000)
      const res = await fetch(`/api/productivity/calls/${logged.callId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration: seconds,
          outcome,
          notes: notes.trim() || undefined,
          endedAt: endedAt.toISOString(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Failed to update call (${res.status})`)
      }
      setLogged({ ...logged, seconds, outcome, notes: notes.trim() })
      setReviewOpen(false)
      toast.success('Call log updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update call')
    } finally {
      setSaving(false)
    }
  }

  // --- inbound dialog -------------------------------------------------------

  const openInboundDialog = () => {
    if (!inbound) return
    setCallerQuery('')
    setMatches(null)
    setSelected(null)
    setInboundPhone('')
    setInboundDuration(formatDuration(inbound.hiddenSeconds))
    setInboundOutcome('connected')
    setInboundOpen(true)
  }

  // Debounced caller search against the CRM (contacts + leads).
  React.useEffect(() => {
    if (!inboundOpen) return
    const q = callerQuery.trim()
    if (q.length < 2) { setMatches(null); setSearching(false); return }
    setSearching(true)
    const controller = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/productivity/calls/match-caller?q=${encodeURIComponent(q)}`, {
          signal: controller.signal, cache: 'no-store',
        })
        const data = await res.json()
        setMatches(res.ok ? (data.matches as CallerMatch[]) : [])
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setMatches([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => { controller.abort(); window.clearTimeout(t) }
  }, [callerQuery, inboundOpen])

  const pickCaller = (m: CallerMatch) => {
    setSelected(m)
    setInboundPhone(m.phone)
  }

  const saveInbound = async () => {
    if (!inbound) return
    const seconds = parseDurationInput(inboundDuration)
    if (seconds === null) {
      toast.error('Enter duration as m:ss (e.g. 2:45) or seconds')
      return
    }
    const phone = (selected?.phone || inboundPhone).trim()
    if (!phone && !selected) {
      toast.error('Pick the caller from the CRM or type their number')
      return
    }
    const who = selected?.name || phone
    setSaving(true)
    try {
      const res = await fetch('/api/productivity/calls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: `Incoming call — ${who}`,
          callType: 'inbound',
          outcome: inboundOutcome,
          duration: seconds,
          relatedModule: selected?.module ?? undefined,
          relatedId: selected?.id ?? undefined,
          startedAt: new Date(inbound.hiddenAt).toISOString(),
          endedAt: new Date(inbound.hiddenAt + seconds * 1000).toISOString(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Failed to log call (${res.status})`)
      }
      // Same signal as the outbound auto-log — detail targets the linked record.
      window.dispatchEvent(new CustomEvent(CALL_LOGGED_EVENT, {
        detail: { relatedModule: selected?.module ?? null, relatedId: selected?.id ?? null },
      }))
      toast.success(`Incoming call logged · ${formatDurationLabel(seconds)}`, {
        description: `${who} — ${inboundOutcome === 'connected' ? 'connected' : 'missed'}`,
      })
      setInboundOpen(false)
      setInbound(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log incoming call')
    } finally {
      setSaving(false)
    }
  }

  // Derive the phase split for the failure banner (talk vs ring).
  const failedPhases = failed ? splitCallPhases(failed.elapsed) : null

  return (
    <>
      {/* Outbound: auto-logged confirmation banner */}
      {logged && !reviewOpen && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-4 right-4 z-40 flex flex-col gap-2.5 rounded-xl border bg-card p-3 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 sm:left-6 sm:right-auto sm:max-w-md sm:flex-row sm:items-center sm:gap-3"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {logged.name || 'Outbound call'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{logged.toNumber}</span>
              {' · '}
              {logged.outcome === 'connected' && 'Talk '}
              <span className="font-mono tabular-nums">{formatDuration(logged.seconds)}</span>
              {' · '}{OUTCOME_LABEL[logged.outcome] ?? logged.outcome}
              {' · '}{logged.outcome === 'connected' ? 'logged automatically' : 'attempt logged'}
            </p>
          </div>
          {/* Actions: own row on phones, inline on sm+ (sm:contents restores
              the original single-row layout without duplicating markup). */}
          <div className="flex items-center justify-end gap-2 sm:contents">
            <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={openReview}>
              Review
            </Button>
            {canTransfer && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 gap-1.5"
                onClick={() => setTransferOpen(true)}
                title="Transfer this call to another member (admin)"
              >
                <PhoneForwarded className="size-4" aria-hidden />
                <span className="hidden sm:inline">Transfer</span>
              </Button>
            )}
            <Button
              size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => setLogged(null)}
              aria-label="Dismiss call confirmation"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Outbound: auto-log failure banner with retry */}
      {failed && !logged && (
        <div
          role="alert"
          className="fixed bottom-4 left-4 right-4 z-40 flex flex-col gap-2.5 rounded-xl border border-destructive/40 bg-card p-3 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 sm:left-6 sm:right-auto sm:max-w-md sm:flex-row sm:items-center sm:gap-3"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {failed.pending.name || 'Outbound call'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{failed.pending.toNumber}</span>
              {failedPhases && (
                <>
                  {' · '}
                  {failedPhases.phase === 'connected' && 'Talk '}
                  <span className="font-mono tabular-nums">
                    {formatDuration(failedPhases.phase === 'connected' ? failedPhases.talkSeconds : failed.elapsed)}
                  </span>
                  {' · '}not saved yet
                </>
              )}
            </p>
          </div>
          {/* Actions: own row on phones, inline on sm+ (sm:contents restores
              the original single-row layout without duplicating markup). */}
          <div className="flex items-center justify-end gap-2 sm:contents">
            <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={retry} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : 'Retry'}
            </Button>
            <Button
              size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => setFailed(null)}
              aria-label="Discard unsaved call"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Inbound: one-tap "you were away" prompt */}
      {inbound && !inboundOpen && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-4 right-4 z-40 flex flex-col gap-2.5 rounded-xl border border-sky-500/40 bg-card p-3 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 sm:left-6 sm:right-auto sm:max-w-md sm:flex-row sm:items-center sm:gap-3"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <PhoneIncoming className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Were you on a call?</p>
            <p className="text-xs text-muted-foreground">
              Away <span className="font-mono tabular-nums">{formatDuration(inbound.hiddenSeconds)}</span> — log it if someone called.
            </p>
          </div>
          {/* Actions: own row on phones, inline on sm+ (sm:contents restores
              the original single-row layout without duplicating markup). */}
          <div className="flex items-center justify-end gap-2 sm:contents">
            <Button size="sm" className="h-8 shrink-0" onClick={openInboundDialog}>
              Log incoming
            </Button>
            <Button
              size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => setInbound(null)}
              aria-label="Dismiss incoming call prompt"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Outbound: review / correct the auto-logged call */}
      <Dialog open={reviewOpen} onOpenChange={(v) => { if (!v && !saving) setReviewOpen(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneOutgoing className="size-4 text-emerald-500" aria-hidden />
              Review call log
            </DialogTitle>
            <DialogDescription>
              {logged?.name ? `${logged.name} · ` : ''}
              {logged?.toNumber}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="call-duration">
                {logged?.outcome === 'connected' ? 'Talk time (auto-detected)' : 'Duration (auto-detected)'}
              </Label>
              <Input
                id="call-duration"
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                placeholder="m:ss — e.g. 2:45"
                inputMode="numeric"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {logged?.outcome === 'connected'
                  ? `Talk time starts when the call connects — the first ${formatDuration(CONNECTED_CALL_SECONDS)} of the dial is the ring (total ${formatDuration(logged.elapsed)}). Edit if needed — m:ss or seconds.`
                  : `The dial never connected (under ${formatDuration(CONNECTED_CALL_SECONDS)} from the dialer), so no talk time. Edit if needed — m:ss or seconds.`}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Outcome</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger aria-label="Call outcome"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="call-notes">Notes</Label>
              <Input
                id="call-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What was discussed?"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setReviewOpen(false)} disabled={saving}>Close</Button>
            <Button onClick={saveReview} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inbound: log an incoming call with CRM caller matching */}
      <Dialog open={inboundOpen} onOpenChange={(v) => { if (!v && !saving) setInboundOpen(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneIncoming className="size-4 text-sky-500" aria-hidden />
              Log incoming call
            </DialogTitle>
            <DialogDescription>
              Away for {inbound ? formatDuration(inbound.hiddenSeconds) : '—'}. Find who called in the CRM or enter their number.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="caller-search">Find caller in CRM</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="caller-search"
                  value={callerQuery}
                  onChange={(e) => setCallerQuery(e.target.value)}
                  placeholder="Name or phone — e.g. Vihaan / 5558"
                  className="pl-8"
                  autoComplete="off"
                />
              </div>
            </div>

            {/* Match results */}
            {searching && (
              <div className="space-y-1.5">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}
            {!searching && matches && matches.length === 0 && callerQuery.trim().length >= 2 && (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                No contact or lead matches &ldquo;{callerQuery.trim()}&rdquo;. Enter the number below instead.
              </p>
            )}
            {!searching && matches && matches.length > 0 && (
              <ul className="max-h-40 space-y-1.5 overflow-y-auto" aria-label="Caller matches">
                {matches.map((m) => {
                  const active = selected?.module === m.module && selected?.id === m.id
                  return (
                    <li key={`${m.module}-${m.id}`}>
                      <button
                        type="button"
                        onClick={() => pickCaller(m)}
                        aria-pressed={active}
                        className={`flex w-full items-center gap-2.5 rounded-lg border p-2 text-left transition-colors ${
                          active ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                        }`}
                      >
                        <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                          m.module === 'contact' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        }`}>
                          <PhoneIncoming className="size-3.5" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{m.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span className="font-mono">{m.phone || 'no number'}</span>
                            {m.extra ? ` · ${m.extra}` : ''}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0 text-[10px] uppercase">{m.module}</Badge>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {selected && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400" role="status">
                Caller linked: {selected.name} ({selected.module}) — the log will attach to their record.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="inbound-phone">Caller number</Label>
              <Input
                id="inbound-phone"
                value={inboundPhone}
                onChange={(e) => { setInboundPhone(e.target.value); if (selected) setSelected(null) }}
                placeholder="+91 98765 43210"
                type="tel"
                inputMode="tel"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="inbound-duration">Duration (pre-filled)</Label>
                <Input
                  id="inbound-duration"
                  value={inboundDuration}
                  onChange={(e) => setInboundDuration(e.target.value)}
                  placeholder="m:ss"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Result</Label>
                <Select value={inboundOutcome} onValueChange={setInboundOutcome}>
                  <SelectTrigger aria-label="Incoming call result"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INBOUND_OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setInboundOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveInbound} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
              Save incoming call
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canTransfer && logged && (
        <CallTransferDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          callId={logged.callId}
          callLabel={logged.name || logged.toNumber}
          onTransferred={() => {
            // Close the banner — the call now belongs to another member and the
            // Calls history view (refreshed via CALL_LOGGED_EVENT) reflects it.
            setLogged(null)
            setTransferOpen(false)
            window.dispatchEvent(new CustomEvent(CALL_LOGGED_EVENT))
          }}
        />
      )}
    </>
  )
}
