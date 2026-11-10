// Client-safe call tracking primitives.
//
// Flow: user taps a phone number → we stash call context in localStorage
// (localStorage survives iOS backgrounding the tab when the native dialer
// opens) → the native `tel:` dialer takes over → when the user returns to
// the tab we compute elapsed seconds and surface the pending call for
// logging. No in-memory timer is authoritative; duration is always
// wall-clock (`Date.now() - startedAt`) so backgrounding, bfcache restores
// and full page reloads all resolve to the same seconds.

export interface PendingCall {
  toNumber: string
  /** Display name of the person/account being called (may be empty). */
  name: string
  /** CRM module context, e.g. 'contact' | 'lead'. */
  module?: string
  /** Related CRM record id. */
  recordId?: string
  /** Epoch ms when the dialer was opened. */
  startedAt: number
  /** True once the tab was hidden at least once (dialer actually opened). */
  wasHidden?: boolean
}

const STORAGE_KEY = 'unstop_pending_call'
const HIDDEN_AT_KEY = 'unstop_hidden_at'
/**
 * Epoch-ms timestamp until which the inbound "Were you on a call?" prompt is
 * suppressed. Set right after an outbound call is detected as completed so the
 * SAME call episode can't also trigger a follow-up incoming-call prompt (the
 * user briefly backgrounding the tab after hanging up must not be misread as a
 * separate incoming call).
 */
const OUTBOUND_COOLDOWN_KEY = 'unstop_outbound_cooldown_until'
/** Cooldown window after an outbound call — covers the hang-up + tab-switch tail. */
export const INBOUND_COOLDOWN_MS = 3 * 60 * 1000

/** Fired on window when a new dial tap begins — lets CallTracker reset a stale banner. */
export const CALL_STARTED_EVENT = 'unstop:call-started'

/** Fired on window after a call auto-logs — views refresh their data on this. */
export const CALL_LOGGED_EVENT = 'unstop:call-logged'

/** Calls shorter than this are treated as cancelled dialer prompts. */
export const MIN_CALL_SECONDS = 5
/**
 * A call that crossed this many seconds is a real conversation — auto-logged
 * as "connected" the moment the user returns to the tab. Shorter attempts
 * (5–9s) still count as dials but log as "no answer" so team analytics can
 * separate calls made from calls connected.
 */
export const CONNECTED_CALL_SECONDS = 10

/**
 * How an outbound dial is split into phases:
 *
 *   dial ──► [ring / connect: first 10s — NOT talk time] ──► [connected: talk
 *   time starts counting here] ──► hang-up (user returns to the tab)
 *
 * A dial only becomes "connected" once it crosses CONNECTED_CALL_SECONDS;
 * talk time starts at that moment (dial + 10s), not at the dial. Shorter
 * dials (5–9s) still count as attempts but log "no answer" with zero talk
 * time; under 5s the dialer prompt was cancelled and nothing is logged.
 */
export interface CallPhases {
  phase: 'ignored' | 'attempt' | 'connected'
  /** Seconds from dial to connect (the whole dial for attempts that never connected). */
  ringSeconds: number
  /** Talk time — seconds spent connected. Always 0 unless phase is 'connected'. */
  talkSeconds: number
}

export function splitCallPhases(elapsedSeconds: number): CallPhases {
  const elapsed = Math.max(0, Math.floor(elapsedSeconds))
  if (elapsed < MIN_CALL_SECONDS) {
    return { phase: 'ignored', ringSeconds: elapsed, talkSeconds: 0 }
  }
  if (elapsed < CONNECTED_CALL_SECONDS) {
    return { phase: 'attempt', ringSeconds: elapsed, talkSeconds: 0 }
  }
  return {
    phase: 'connected',
    ringSeconds: CONNECTED_CALL_SECONDS,
    talkSeconds: elapsed - CONNECTED_CALL_SECONDS,
  }
}

/**
 * Inbound calls: a browser can't hear the ring, but an answered/declined call
 * backgrounds the tab. If the user returns after being away at least this
 * long (with no outbound dial in flight), offer the one-tap incoming-call log.
 */
export const INBOUND_PROMPT_MIN_SECONDS = 20
/** Absences longer than this mean "left the app hours ago" — not a call. */
export const MAX_INBOUND_WINDOW_SECONDS = 4 * 60 * 60
/** Pending context older than this is stale — discard on load. */
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000

export function startCallTracking(input: {
  toNumber: string
  name?: string
  module?: string
  recordId?: string
}): void {
  const pending: PendingCall = {
    toNumber: input.toNumber,
    name: input.name ?? '',
    module: input.module,
    recordId: input.recordId,
    startedAt: Date.now(),
    wasHidden: false,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending))
    // Notify in-page listeners (CallTracker) so a stale banner resets immediately.
    window.dispatchEvent(new CustomEvent(CALL_STARTED_EVENT))
  } catch {
    /* private mode / storage full — call simply won't auto-log */
  }
}

export function readPendingCall(): PendingCall | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const pending = JSON.parse(raw) as PendingCall
    if (!pending?.toNumber || typeof pending.startedAt !== 'number') return null
    if (Date.now() - pending.startedAt > MAX_PENDING_AGE_MS) {
      clearPendingCall()
      return null
    }
    return pending
  } catch {
    return null
  }
}

export function markPendingCallHidden(): void {
  try {
    const pending = readPendingCall()
    if (!pending) return
    // Already tracking a real call (dialer backgrounded us before) — keep it;
    // re-backgrounding mid-call must NOT clear the context.
    if (pending.wasHidden) return
    // If the tap is old, this hidden was unrelated (user checked another app) —
    // the dialer prompt was cancelled/abandoned. Drop the stale context.
    if (Date.now() - pending.startedAt > 90_000) {
      clearPendingCall()
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...pending, wasHidden: true }))
  } catch {
    /* ignore */
  }
}

export function clearPendingCall(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

// --- inbound call detection -----------------------------------------------
// A browser cannot hear the phone ring, but on iPhone an answered call (or a
// declined one) backgrounds the tab exactly like the outbound dialer does.
// We remember WHEN the tab was last hidden; if the user comes back after a
// long-enough absence with NO outbound call in flight, CallTracker offers a
// one-tap "log incoming call" prompt with the away time pre-filled.

/**
 * Remember that the tab just became hidden (epoch ms). Only the FIRST hidden
 * of an absence episode is kept so the away time measures the full episode.
 */
export function markTabHidden(): void {
  try {
    if (localStorage.getItem(HIDDEN_AT_KEY)) return
    localStorage.setItem(HIDDEN_AT_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

/** Epoch ms when the current absence started, or null. Does NOT clear it. */
export function readHiddenAt(): number | null {
  try {
    const raw = localStorage.getItem(HIDDEN_AT_KEY)
    if (!raw) return null
    const t = Number(raw)
    return Number.isFinite(t) && t > 0 ? t : null
  } catch {
    return null
  }
}

export function clearHiddenAt(): void {
  try {
    localStorage.removeItem(HIDDEN_AT_KEY)
  } catch {
    /* ignore */
  }
}

// --- outbound cooldown (prevents the same call from re-prompting inbound) ---
// Right after an outbound call is detected as completed we mark a cooldown
// window. Any tab-absence that happens inside this window is assumed to be the
// tail of the SAME call episode (user hanging up, switching back to the app)
// and must NOT surface the "Were you on a call?" inbound prompt — that was the
// whole point of the user's "don't show again and again for the same call"
// request.

/** Start the post-outbound cooldown (called the moment a dial is completed). */
export function markOutboundCooldown(ms: number = INBOUND_COOLDOWN_MS): void {
  try {
    localStorage.setItem(OUTBOUND_COOLDOWN_KEY, String(Date.now() + ms))
  } catch {
    /* ignore */
  }
}

/**
 * Returns the epoch-ms when the cooldown expires, or null if inactive/expired.
 * Expired entries are cleaned up lazily.
 */
export function readOutboundCooldown(): number | null {
  try {
    const raw = localStorage.getItem(OUTBOUND_COOLDOWN_KEY)
    if (!raw) return null
    const t = Number(raw)
    if (!Number.isFinite(t) || t <= Date.now()) {
      localStorage.removeItem(OUTBOUND_COOLDOWN_KEY)
      return null
    }
    return t
  } catch {
    return null
  }
}

export function clearOutboundCooldown(): void {
  try {
    localStorage.removeItem(OUTBOUND_COOLDOWN_KEY)
  } catch {
    /* ignore */
  }
}

/** Elapsed whole seconds since the dialer was opened. */
export function pendingElapsedSeconds(pending: PendingCall): number {
  return Math.max(0, Math.floor((Date.now() - pending.startedAt) / 1000))
}

/** 83 → "1:23", 3725 → "1:02:05". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** Human label: 83 → "1m 23s", 45 → "45s", 3725 → "1h 02m". */
export function formatDurationLabel(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

/** Parse "1:23" / "01:02:05" / "83" → seconds (null if unparseable/negative). */
export function parseDurationInput(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) {
    const v = Number(trimmed)
    return v >= 0 && v < 24 * 3600 ? v : null
  }
  const parts = trimmed.split(':').map((p) => p.trim())
  if (parts.length > 3 || parts.some((p) => p === '' || !/^\d{1,2}$/.test(p))) return null
  let seconds = 0
  for (const part of parts) seconds = seconds * 60 + Number(part)
  return seconds < 24 * 3600 ? seconds : null
}

/** Strip formatting for tel: hrefs — keep leading + and digits only. */
export function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '')
  return `tel:${cleaned}`
}
