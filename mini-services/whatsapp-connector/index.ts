/**
 * WhatsApp connector mini-service (baileys)
 * -----------------------------------------
 * A standalone bun + baileys service that links the CRM workspace to a real
 * WhatsApp account via a QR code (WhatsApp Web multi-device protocol), plus a
 * fully offline DEMO mode so the whole UX is demonstrable inside the sandbox
 * where outbound WhatsApp ports may be blocked.
 *
 * Port 3010 is hardcoded (sandbox constraint). The gateway in front of the
 * Next.js app exposes only port 3000, so the browser calls RELATIVE urls with
 * `?XTransformPort=3010` (e.g. fetch('/wa/status?XTransformPort=3010')) and the
 * gateway rewrites the upstream port. This service therefore accepts any path
 * prefix and routes on the LAST path segment (`/status`, `/wa/status`, ...).
 *
 * Robustness contract (the sandbox may block outbound WhatsApp traffic):
 *   - The service NEVER crashes on network failures. Every baileys touchpoint
 *     is wrapped in try/catch (+ timeouts) and global uncaughtException /
 *     unhandledRejection guards keep the process alive.
 *   - /status ALWAYS answers, even while baileys is mid-connect or broken.
 *   - Real linking that cannot complete within ~40s degrades to status
 *     'error' (never a crash), and Demo mode provides a guaranteed working
 *     connected session.
 *
 * Auth state lives in ./auth-state and is deliberately NOT wiped on restart —
 * baileys restores the session from it, so a service restart reconnects
 * WITHOUT a re-scan. It is only wiped on explicit /disconnect (or a loggedOut
 * close from WhatsApp).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import path from 'path'

/**
 * Minimal ambient typing for the bun runtime global. This folder has its own
 * tsconfig (bun-types), but the root project `tsc --noEmit` also compiles this
 * file WITHOUT bun-types loaded — a module-scoped ambient declaration keeps
 * both compilers happy without leaking anything into the root program.
 */
declare const Bun: any

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = 3010
const SERVICE_NAME = 'whatsapp-connector'

const SERVICE_DIR: string = (import.meta as any).dir ?? process.cwd()
const AUTH_DIR = path.join(SERVICE_DIR, 'auth-state')
const DEMO_SESSION_FILE = path.join(SERVICE_DIR, 'session-demo.json')
const MESSAGES_DIR = path.join(SERVICE_DIR, 'demo')
const MESSAGES_FILE = path.join(MESSAGES_DIR, 'messages.json')
const CHATS_FILE = path.join(MESSAGES_DIR, 'chats.json')

/** A freshly generated WhatsApp Web QR stays valid for ~60 seconds. */
const QR_TTL_MS = 60_000
/** If no QR can even be generated within this long, degrade to 'error'.
 *  (Reaching the QR event proves the WhatsApp network path works.) */
const LINK_TIMEOUT_MS = 40_000
/**
 * Once a QR HAS been emitted, the bottleneck is a human pointing a phone
 * camera — give them a comfortable multi-minute window (baileys re-emits
 * fresh QRs internally; each re-emission re-arms this horizon). The old hard
 * 40s cap killed healthy QR sessions mid-scan.
 */
const QR_SCAN_GRACE_MS = 180_000
/** Send / version-fetch timeouts (network may hang when ports are blocked). */
const SEND_TIMEOUT_MS = 15_000
const VERSION_TIMEOUT_MS = 8_000
/** Message log is capped in memory and in demo/messages.json. */
const MESSAGE_CAP = 200
/** A pairing code stays valid for ~60 seconds (re-requestable). */
const PAIR_TTL_MS = 60_000

/** Demo session identity (fully offline, no network). */
const DEMO_ME = { phone: '15550012345', name: 'Demo WhatsApp Account' }
/** The fake contact that echoes messages back in demo mode. */
const DEMO_CONTACT = '15557654321'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type WaMode = 'real' | 'demo'
type WaStatusState = 'disconnected' | 'scanning' | 'connected' | 'error'

interface StoredMessage {
  id: string
  from: string
  to: string
  text: string
  timestamp: number
  direction: 'in' | 'out'
}

/** One conversation row in the persistent chat list (demo/chats.json). */
interface WaChatEntry {
  /** Peer JID, e.g. `15551234567@s.whatsapp.net`. */
  peer: string
  /** Contact name when known (contacts.upsert / history sync), else ''. */
  name: string
  lastMessage: string
  lastTimestamp: number
  unreadCount: number
  messageCount: number
}

const state = {
  mode: 'real' as WaMode,
  status: 'disconnected' as WaStatusState,
  /** Last QR rendered to a data URL (null when not linking / expired). */
  qr: null as { dataUrl: string; createdAt: number } | null,
  me: null as { phone: string; name: string } | null,
  connectedAt: null as number | null,
  error: null as string | null,
}

/** Active baileys socket (any-typed on purpose: baileys v7 types are heavy). */
let sock: any = null
/** Pending demo-mode timers (echo replies / welcome message). */
const demoTimers = new Set<ReturnType<typeof setTimeout>>()
/**
 * Bounded auto-restarts: baileys closes with code 515 (restartRequired) right
 * after a successful QR scan, and transient stream errors also need a fresh
 * socket. Auto-restarting makes a scanned link complete and self-heals brief
 * network blips — but the count is capped so a blocked network cannot churn
 * forever.
 */
const MAX_AUTO_RESTARTS = 5
let autoRestartCount = 0

/** In-memory message log, oldest first, capped at MESSAGE_CAP. */
let messages: StoredMessage[] = []
/** Persistent chat list — NEVER cleared on disconnect/reconnect, only merged. */
const chats = new Map<string, WaChatEntry>()
/** jid → contact name (baileys contacts.upsert / history sync). */
const contacts = new Map<string, string>()

// ---------------------------------------------------------------------------
// Pairing state (phone-number linking, baileys requestPairingCode)
// ---------------------------------------------------------------------------

/** Last issued pairing code (null when none active). */
let pairing: { code: string; phoneNumber: string; createdAt: number } | null = null
/** Phone number awaiting a pairing-code request (set by POST /pair). */
let pendingPairNumber: string | null = null
let pairInFlight = false
/** Driver interval that retries the pairing request until the socket is ready. */
let pairDriver: ReturnType<typeof setInterval> | null = null
let pairResolve: ((code: string) => void) | null = null
let pairReject: ((e: Error) => void) | null = null

// ---------------------------------------------------------------------------
// History-sync window state (FIX 3)
// ---------------------------------------------------------------------------

/** True while the post-'open' chat history sync is streaming in. */
let syncingChats = false
let historySettleTimer: ReturnType<typeof setTimeout> | null = null
let historyMaxTimer: ReturnType<typeof setTimeout> | null = null

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function log(...args: unknown[]): void {
  console.log(`[wa ${new Date().toISOString()}]`, ...args)
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/** Permissive CORS headers, mirroring the realtime mini-service. */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

async function readJson(req: Request): Promise<any> {
  try {
    return await Promise.race([
      req.json(),
      new Promise((resolve) => setTimeout(() => resolve({}), 5_000)),
    ])
  } catch {
    return {}
  }
}

/**
 * A silenced pino-shaped logger. baileys logs chattily and expects a pino
 * interface; providing this stub avoids a pino dependency and noisy output.
 */
const silentLogger: any = {
  level: 'silent',
  child: () => silentLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
}

// ---------------------------------------------------------------------------
// Message store (memory + demo/messages.json)
// ---------------------------------------------------------------------------

function loadMessages(): void {
  try {
    if (existsSync(MESSAGES_FILE)) {
      const raw = JSON.parse(readFileSync(MESSAGES_FILE, 'utf-8'))
      messages = Array.isArray(raw) ? raw.slice(-MESSAGE_CAP) : []
    }
  } catch (e) {
    console.error('[wa] failed to load message log:', errMsg(e))
    messages = []
  }
}

function persistMessages(): void {
  try {
    mkdirSync(MESSAGES_DIR, { recursive: true })
    writeFileSync(MESSAGES_FILE, JSON.stringify(messages.slice(-MESSAGE_CAP), null, 2))
  } catch (e) {
    console.error('[wa] failed to persist message log:', errMsg(e))
  }
}

let messagePersistTimer: ReturnType<typeof setTimeout> | null = null

/** Debounced persist — used by history sync which can deliver hundreds of msgs. */
function schedulePersistMessages(): void {
  if (messagePersistTimer) return
  messagePersistTimer = setTimeout(() => {
    messagePersistTimer = null
    persistMessages()
  }, 500)
}

function pushMessageOnly(m: StoredMessage): void {
  // Dedupe by id (history sync can overlap with live notify for the same msg).
  if (messages.some((x) => x.id === m.id)) return
  messages.push(m)
  if (messages.length > MESSAGE_CAP) messages = messages.slice(-MESSAGE_CAP)
}

function pushMessage(m: StoredMessage): void {
  pushMessageOnly(m)
  recordChatMessage(m, { bumpUnread: m.direction === 'in' })
  persistMessages()
}

/** Newest first, limited. */
function recentMessages(limit: number): StoredMessage[] {
  return [...messages]
    .sort((a, b) => a.timestamp - b.timestamp)
    .reverse()
    .slice(0, limit)
}

/** Messages belonging to one chat (the "other side" is `peerDigits`), newest first. */
function messagesForPeer(peerDigits: string, limit: number): StoredMessage[] {
  return messages
    .filter((m) => (m.direction === 'in' ? m.from === peerDigits : m.to === peerDigits))
    .sort((a, b) => a.timestamp - b.timestamp)
    .reverse()
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Chat store (memory + demo/chats.json) — merge-only, survives reconnects
// ---------------------------------------------------------------------------

function loadChats(): void {
  try {
    if (!existsSync(CHATS_FILE)) return
    const raw = JSON.parse(readFileSync(CHATS_FILE, 'utf-8'))
    if (Array.isArray(raw)) {
      for (const c of raw) {
        if (c && typeof c.peer === 'string') {
          chats.set(c.peer, {
            peer: c.peer,
            name: String(c.name ?? ''),
            lastMessage: String(c.lastMessage ?? ''),
            lastTimestamp: Number(c.lastTimestamp ?? 0),
            unreadCount: Number(c.unreadCount ?? 0),
            messageCount: Number(c.messageCount ?? 0),
          })
        }
      }
    }
  } catch (e) {
    console.error('[wa] failed to load chat store:', errMsg(e))
  }
}

function persistChats(): void {
  try {
    mkdirSync(MESSAGES_DIR, { recursive: true })
    const rows = [...chats.values()].sort((a, b) => b.lastTimestamp - a.lastTimestamp)
    writeFileSync(CHATS_FILE, JSON.stringify(rows, null, 2))
  } catch (e) {
    console.error('[wa] failed to persist chat store:', errMsg(e))
  }
}

let chatsPersistTimer: ReturnType<typeof setTimeout> | null = null

/** Debounced save on change. */
function scheduleChatsPersist(): void {
  if (chatsPersistTimer) return
  chatsPersistTimer = setTimeout(() => {
    chatsPersistTimer = null
    persistChats()
  }, 800)
}

/**
 * Fold a message into the chat store.
 * - inbound (not fromMe) → unreadCount++, preview + counters update
 * - outbound (fromMe)    → unreadCount reset to 0, preview update
 */
function recordChatMessage(m: StoredMessage, opts: { bumpUnread: boolean }): void {
  try {
    const digits = (m.direction === 'in' ? m.from : m.to).replace(/[^0-9]/g, '')
    if (!digits) return
    const peer = `${digits}@s.whatsapp.net`
    const ts = m.timestamp || Date.now()
    let entry = chats.get(peer)
    if (!entry) {
      entry = { peer, name: contacts.get(peer) ?? '', lastMessage: '', lastTimestamp: 0, unreadCount: 0, messageCount: 0 }
      chats.set(peer, entry)
    }
    if (!entry.name) entry.name = contacts.get(peer) ?? ''
    entry.messageCount += 1
    // Only the newest message becomes the preview (history arrives unordered).
    if (ts >= entry.lastTimestamp) {
      entry.lastMessage = m.text
      entry.lastTimestamp = ts
    }
    if (opts.bumpUnread) entry.unreadCount += 1
    scheduleChatsPersist()
  } catch (e) {
    console.error('[wa] chat record failed:', errMsg(e))
  }
}

/** Sorted by lastTimestamp desc, limited — response shape for GET /chats. */
function sortedChats(limit: number): WaChatEntry[] {
  return [...chats.values()]
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
    .slice(0, limit)
    .map((c) => ({ ...c }))
}

/** POST /chats/read — clear unread for one chat and persist immediately. */
function handleChatsRead(peer: string): { ok: boolean; error?: string } {
  const digits = String(peer ?? '').replace(/[^0-9]/g, '')
  if (!digits) return { ok: false, error: 'A chat peer is required.' }
  const key = [...chats.keys()].find((k) => (k.split('@')[0] ?? '') === digits)
  if (!key) return { ok: false, error: 'Chat not found.' }
  chats.get(key)!.unreadCount = 0
  persistChats()
  return { ok: true }
}

/** Remember a contact name and backfill any matching chat row. */
function rememberContact(c: any): void {
  try {
    const id = String(c?.id ?? '')
    if (!id) return
    const name = String(c?.name ?? c?.notify ?? c?.verifiedName ?? '').trim()
    if (!name) return
    contacts.set(id, name)
    const entry = chats.get(id)
    if (entry && !entry.name) {
      entry.name = name
      scheduleChatsPersist()
    }
  } catch (e) {
    console.error('[wa] contact remember failed:', errMsg(e))
  }
}

function onContactsUpsert(list: any): void {
  try {
    if (Array.isArray(list)) for (const c of list) rememberContact(c)
  } catch (e) {
    console.error('[wa] contacts handler failed:', errMsg(e))
  }
}

// ---------------------------------------------------------------------------
// History-sync window (opens on connection 'open', settles after quiet period)
// ---------------------------------------------------------------------------

function startChatSync(): void {
  syncingChats = true
  if (historyMaxTimer) clearTimeout(historyMaxTimer)
  // Hard cap: even a silent sync window ends 20s after 'open'.
  historyMaxTimer = setTimeout(() => endChatSync('max window elapsed'), 20_000)
  log('chat history sync window opened')
}

function noteHistoryChunk(): void {
  syncingChats = true
  if (historySettleTimer) clearTimeout(historySettleTimer)
  // 10s debounce after the LAST messaging-history.set event.
  historySettleTimer = setTimeout(() => endChatSync('settled'), 10_000)
}

function endChatSync(reason: string): void {
  if (historySettleTimer) { clearTimeout(historySettleTimer); historySettleTimer = null }
  if (historyMaxTimer) { clearTimeout(historyMaxTimer); historyMaxTimer = null }
  if (syncingChats) {
    syncingChats = false
    log(`chat history sync finished (${reason})`)
  }
}

/** 'messaging-history.set' — upsert chats, messages (unread=0) and contacts. */
function onHistorySet({ chats: historyChats, messages: historyMessages, contacts: historyContacts }: any): void {
  try {
    noteHistoryChunk()
    for (const c of Array.isArray(historyChats) ? historyChats : []) {
      try {
        const jid = String(c?.id ?? '')
        if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || !jid.endsWith('@s.whatsapp.net')) continue
        const tsSec = Number(c?.conversationTimestamp ?? c?.lastMessageRecvTimestamp ?? 0)
        const ts = tsSec > 0 ? tsSec * 1000 : 0
        const name = String(c?.name ?? '').trim()
        const existing = chats.get(jid)
        if (existing) {
          // Merge only — never clear or reset an existing chat row.
          if (name && !existing.name) existing.name = name
          if (ts > existing.lastTimestamp) existing.lastTimestamp = ts
        } else {
          // History chats start with unreadCount 0.
          chats.set(jid, { peer: jid, name: name || (contacts.get(jid) ?? ''), lastMessage: '', lastTimestamp: ts, unreadCount: 0, messageCount: 0 })
        }
      } catch (inner) {
        console.error('[wa] failed to upsert one history chat:', errMsg(inner))
      }
    }
    for (const m of Array.isArray(historyMessages) ? historyMessages : []) addHistoryMessage(m)
    for (const c of Array.isArray(historyContacts) ? historyContacts : []) rememberContact(c)
    scheduleChatsPersist()
    schedulePersistMessages()
  } catch (e) {
    console.error('[wa] messaging-history.set handler failed:', errMsg(e))
  }
}

/** Map a history WAMessage to the StoredMessage shape (no unread bump). */
function addHistoryMessage(m: any): void {
  try {
    if (!m?.key?.id) return
    const jid = String(m.key.remoteJid ?? '')
    if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || !jid.endsWith('@s.whatsapp.net')) return
    const text = extractText(m)
    if (!text.trim()) return
    const fromMe = Boolean(m.key.fromMe)
    const digits = jid.split('@')[0] || jid
    const myPhone = state.me?.phone ?? ''
    if (!myPhone) return // history flows after 'open', so me is always known
    const stored: StoredMessage = {
      id: String(m.key.id),
      from: fromMe ? myPhone : digits,
      to: fromMe ? digits : myPhone,
      text,
      timestamp: Number(m.messageTimestamp ?? 0) * 1000 || Date.now(),
      direction: fromMe ? 'out' : 'in',
    }
    if (messages.some((x) => x.id === stored.id)) return
    messages.push(stored)
    if (messages.length > MESSAGE_CAP) messages = messages.slice(-MESSAGE_CAP)
    recordChatMessage(stored, { bumpUnread: false })
  } catch (e) {
    console.error('[wa] history message failed:', errMsg(e))
  }
}

// ---------------------------------------------------------------------------
// Pairing helpers (phone-number linking)
// ---------------------------------------------------------------------------

function stopPairDriver(): void {
  if (pairDriver) { clearInterval(pairDriver); pairDriver = null }
}

function settlePendingPair(code: string): void {
  stopPairDriver()
  const r = pairResolve
  pairResolve = null
  pairReject = null
  r?.(code)
}

function failPendingPair(e: Error): void {
  stopPairDriver()
  const r = pairReject
  pairResolve = null
  pairReject = null
  r?.(e)
}

function clearPairing(): void {
  pairing = null
  pendingPairNumber = null
  stopPairDriver()
  pairResolve = null
  pairReject = null
}

/** Call baileys requestPairingCode once the WS handshake is proven ready. */
async function runPairingRequest(): Promise<void> {
  if (!pendingPairNumber || pairInFlight) return
  pairInFlight = true
  const number = pendingPairNumber
  const handshakeReady = !!state.qr
  try {
    if (!sock) throw new Error('WhatsApp socket is not ready')
    const code: any = await Promise.race([
      sock.requestPairingCode(number),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('pairing request timed out')), 15_000),
      ),
    ])
    const normalized = String(code ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
    if (!normalized) throw new Error('empty pairing code')
    pairing = { code: normalized, phoneNumber: number, createdAt: Date.now() }
    log(`pairing code issued for +${number}`)
    settlePendingPair(normalized)
  } catch (e) {
    log(`pairing code request failed: ${errMsg(e)}`)
    // If the handshake was never proven (no QR yet) let the driver retry;
    // a failure on a ready socket is real — surface it to the /pair caller.
    if (handshakeReady) failPendingPair(e instanceof Error ? e : new Error(errMsg(e)))
  } finally {
    pairInFlight = false
  }
}

// ---------------------------------------------------------------------------
// Demo mode (offline, always works)
// ---------------------------------------------------------------------------

function persistDemoSession(): void {
  try {
    writeFileSync(DEMO_SESSION_FILE, JSON.stringify({
      mode: 'demo',
      me: DEMO_ME,
      connectedAt: state.connectedAt,
    }, null, 2))
  } catch (e) {
    console.error('[wa] failed to persist demo session:', errMsg(e))
  }
}

function clearDemoTimers(): void {
  for (const t of demoTimers) {
    try { clearTimeout(t) } catch { /* ignore */ }
  }
  demoTimers.clear()
}

function scheduleDemoIncoming(text: string, delayMs = 1_000 + Math.floor(Math.random() * 500)): void {
  const t = setTimeout(() => {
    demoTimers.delete(t)
    try {
      pushMessage({
        id: `demo-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: DEMO_CONTACT,
        to: state.me?.phone ?? DEMO_ME.phone,
        text,
        timestamp: Date.now(),
        direction: 'in',
      })
      log('demo incoming message:', text.slice(0, 80))
    } catch (e) {
      console.error('[wa] demo incoming failed:', errMsg(e))
    }
  }, delayMs)
  demoTimers.add(t)
}

function restoreDemoSession(): boolean {
  try {
    if (!existsSync(DEMO_SESSION_FILE)) return false
    const raw = JSON.parse(readFileSync(DEMO_SESSION_FILE, 'utf-8'))
    state.mode = 'demo'
    state.status = 'connected'
    state.me = raw?.me ?? DEMO_ME
    state.connectedAt = typeof raw?.connectedAt === 'number' ? raw.connectedAt : Date.now()
    state.qr = null
    state.error = null
    if (chats.size === 0) seedDemoChats()
    log('restored persisted demo session for', state.me?.phone)
    return true
  } catch (e) {
    console.error('[wa] failed to restore demo session:', errMsg(e))
    return false
  }
}

/** Seed 4 fake chats (names, previews, unread mix) so the chat UI is fully testable offline. */
function seedDemoChats(): void {
  try {
    const me = state.me?.phone ?? DEMO_ME.phone
    const now = Date.now()
    const seeds: { name: string; phone: string; msgs: { text: string; dir: 'in' | 'out'; agoMin: number }[] }[] = [
      {
        name: 'Ava Martinez', phone: '15551234567', msgs: [
          { text: 'Hi! Is the Tuesday product demo still on?', dir: 'in', agoMin: 52 },
          { text: 'Yes — sending the calendar invite now 📩', dir: 'out', agoMin: 50 },
          { text: 'Perfect, see you then!', dir: 'in', agoMin: 8 },
        ],
      },
      {
        name: 'Liam Chen', phone: '15559876543', msgs: [
          { text: 'Could you share the pricing sheet?', dir: 'in', agoMin: 180 },
          { text: 'Sent — check your email.', dir: 'out', agoMin: 175 },
        ],
      },
      {
        name: 'Priya Sharma', phone: '919876543210', msgs: [
          { text: 'The onboarding doc was super helpful, thanks!', dir: 'in', agoMin: 1_440 },
          { text: 'Glad it helped — ping me anytime.', dir: 'out', agoMin: 1_435 },
          { text: 'Quick question about the API limits…', dir: 'in', agoMin: 1_420 },
        ],
      },
      {
        name: 'Noah Williams', phone: '447700900123', msgs: [
          { text: 'Got it, thanks for the quick turnaround 👍', dir: 'out', agoMin: 2_880 },
        ],
      },
    ]
    for (const s of seeds) {
      const peer = `${s.phone}@s.whatsapp.net`
      contacts.set(peer, s.name)
      // Build the chat entry deterministically (never double-bumps on re-seed).
      let lastTs = 0
      let lastMsg = ''
      let unread = 0
      let count = 0
      for (const m of s.msgs) {
        const ts = now - m.agoMin * 60_000
        pushMessageOnly({
          id: `demo-seed-${s.phone}-${m.agoMin}`,
          from: m.dir === 'in' ? s.phone : me,
          to: m.dir === 'in' ? me : s.phone,
          text: m.text,
          timestamp: ts,
          direction: m.dir,
        })
        count++
        lastTs = ts
        lastMsg = m.text
        if (m.dir === 'in') unread += 1
        else unread = 0
      }
      const existing = chats.get(peer)
      chats.set(peer, {
        peer,
        name: s.name,
        lastMessage: lastMsg,
        lastTimestamp: Math.max(lastTs, existing?.lastTimestamp ?? 0),
        unreadCount: existing ? existing.unreadCount : unread,
        messageCount: Math.max(count, existing?.messageCount ?? 0),
      })
    }
    contacts.set(`${DEMO_CONTACT}@s.whatsapp.net`, 'Demo Echo')
    persistChats()
    log('demo chats seeded (4 chats)')
  } catch (e) {
    console.error('[wa] demo chat seeding failed:', errMsg(e))
  }
}

/**
 * Enter a fake connected session. Refused when a real session is actively
 * linking or connected ("already in real mode").
 */
function demoConnect(): { ok: boolean; status?: WaStatusState; error?: string } {
  if (state.mode === 'real' && (state.status === 'scanning' || state.status === 'connected')) {
    return {
      ok: false,
      error: `A real WhatsApp session is ${state.status} — disconnect it before switching to demo mode.`,
    }
  }
  try { stopReal() } catch { /* ignore */ }
  clearDemoTimers()
  state.mode = 'demo'
  state.status = 'connected'
  state.error = null
  state.qr = null
  state.connectedAt = Date.now()
  state.me = { ...DEMO_ME }
  persistDemoSession()
  seedDemoChats()
  scheduleDemoIncoming(
    'Demo session started. Send a message and the demo contact will echo it back in about a second.',
    1_200,
  )
  log('demo session connected')
  return { ok: true, status: state.status }
}

// ---------------------------------------------------------------------------
// Real mode (baileys)
// ---------------------------------------------------------------------------

function clearWatchdog(): void {
  // The watchdog is stored on state via module var below.
  if (watchdogTimer) {
    try { clearTimeout(watchdogTimer) } catch { /* ignore */ }
    watchdogTimer = null
  }
}

let watchdogTimer: ReturnType<typeof setTimeout> | null = null

function armWatchdog(durationMs: number = LINK_TIMEOUT_MS): void {
  clearWatchdog()
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null
    try {
      if (state.mode === 'real' && state.status !== 'connected') {
        state.status = 'error'
        state.error = pendingPairNumber || pairing
          ? 'Pairing timed out — request a new code. Double-check the number includes the country code, then try again.'
          : state.qr
            // A QR was delivered, so the network path to WhatsApp works —
            // this timeout means the user simply did not scan in time.
            ? 'The QR was not scanned in time. Tap “Try again” for a fresh QR, then scan it right away (WhatsApp → Settings → Linked devices → Link a device).'
            : 'Timed out reaching WhatsApp (~40s). The sandbox may block outbound WhatsApp ports. ' +
              'The service is still healthy — try Reconnect, or use Demo connect to explore the full UX offline.'
        log('link watchdog fired — status=error (service stays alive)')
        // End the still-running socket so late QR events cannot flip the
        // degraded 'error' state back to 'scanning'.
        stopReal()
      }
    } catch (e) {
      console.error('[wa] watchdog failed:', errMsg(e))
    }
  }, durationMs)
}

/** Render a raw QR payload into a PNG data URL via the qrcode package. */
async function setQrFromPayload(payload: string): Promise<void> {
  try {
    const mod: any = await import('qrcode')
    const toDataURL = mod.toDataURL ?? mod.default?.toDataURL
    if (typeof toDataURL !== 'function') throw new Error('qrcode.toDataURL unavailable')
    const dataUrl = await toDataURL(payload, { margin: 1, width: 480, errorCorrectionLevel: 'L' })
    state.qr = { dataUrl: String(dataUrl), createdAt: Date.now() }
    if (state.status !== 'connected') state.status = 'scanning'
    log('QR generated (expires in ~60s)')
  } catch (e) {
    console.error('[wa] QR encode failed:', errMsg(e))
  }
}

function extractText(m: any): string {
  try {
    const msg = m?.message
    if (!msg) return ''
    return String(
      msg.conversation ??
      msg.extendedTextMessage?.text ??
      msg.imageMessage?.caption ??
      msg.videoMessage?.caption ??
      msg.documentMessage?.caption ??
      '',
    )
  } catch {
    return ''
  }
}

function onConnectionUpdate(u: any): void {
  try {
    if (u?.qr) {
      void setQrFromPayload(String(u.qr))
      // The QR event proves the WS handshake completed and the network path
      // to WhatsApp works — re-arm the watchdog with the long scan horizon so
      // a human has time to scan (the tight 40s cap only guards the pre-QR
      // phase). Phone-number pairing also rides this: requestPairingCode can
      // now go out (fast path; the /pair driver is the fallback).
      armWatchdog(QR_SCAN_GRACE_MS)
      if (pendingPairNumber && !pairing && !pairInFlight) void runPairingRequest()
    }

    if (u?.connection === 'connecting') {
      // Spec mapping: connecting → scanning.
      if (state.status !== 'connected') state.status = 'scanning'
    }

    if (u?.connection === 'open') {
      clearWatchdog()
      autoRestartCount = 0
      clearPairing()
      state.mode = 'real'
      state.status = 'connected'
      state.qr = null
      state.error = null
      state.connectedAt = Date.now()
      const user = sock?.user ?? {}
      const phone = String(user?.id ?? '').split(':')[0] || 'unknown'
      const name = String(user?.verifiedName ?? user?.name ?? 'WhatsApp account')
      state.me = { phone, name }
      log(`real session connected: +${phone} (${name})`)
      // Open the history-sync window (10s settle debounce / 20s max).
      startChatSync()
    }

    if (u?.connection === 'close') {
      const code = (u?.lastDisconnect?.error as any)?.output?.statusCode
      const loggedOut = code === 401 || code === 403
      const wasConnected = state.status === 'connected'
      log(`connection close (code=${String(code)}) wasConnected=${wasConnected}`)

      // Detach listeners from the dead socket; do NOT wipe ./auth-state here
      // (a plain network close must keep the saved session for auto-reconnect).
      try { sock?.ev?.removeAllListeners?.('connection.update') } catch { /* ignore */ }
      try { sock?.ev?.removeAllListeners?.('messages.upsert') } catch { /* ignore */ }
      try { sock?.ev?.removeAllListeners?.('creds.update') } catch { /* ignore */ }
      try { sock?.ev?.removeAllListeners?.('messaging-history.set') } catch { /* ignore */ }
      try { sock?.ev?.removeAllListeners?.('contacts.upsert') } catch { /* ignore */ }
      try { sock?.ev?.removeAllListeners?.('contacts.update') } catch { /* ignore */ }
      sock = null
      endChatSync('socket closed')

      if (loggedOut) {
        // The device was removed on the phone side — the saved session is dead.
        wipeAuthState()
        clearPairing()
        state.status = 'disconnected'
        state.me = null
        state.connectedAt = null
        state.qr = null
        state.error = null
        log('logged out remotely — auth state wiped')
        return
      }

      // baileys requires a fresh socket after registration (code 515
      // restartRequired) and after transient stream errors. Auto-restart a
      // bounded number of times so a scanned QR completes and brief blips
      // self-heal; the watchdog degrades to 'error' if linking never lands.
      const qrStillFresh = !!state.qr && Date.now() - state.qr.createdAt < QR_TTL_MS
      const shouldAutoRestart =
        code === 515 || wasConnected || (state.status === 'scanning' && qrStillFresh)
      if (autoRestartCount < MAX_AUTO_RESTARTS && shouldAutoRestart) {
        autoRestartCount++
        log(`auto-restarting link (attempt ${autoRestartCount}/${MAX_AUTO_RESTARTS}, close code=${String(code)})`)
        void startReal()
        return
      }

      if (wasConnected) {
        state.status = 'error'
        state.error = 'WhatsApp connection lost (network error). Reconnect to restore the session.'
      } else if (state.status !== 'error') {
        state.status = 'error'
        state.error = `Could not reach WhatsApp (close code ${String(code ?? 'unknown')}). Reconnect to retry, or use Demo connect.`
      }
    }
  } catch (e) {
    console.error('[wa] connection.update handler failed:', errMsg(e))
  }
}

function onMessagesUpsert({ messages: ups, type }: any): void {
  try {
    if (type !== 'notify' || !Array.isArray(ups)) return
    for (const m of ups) {
      try {
        if (!m?.key || m.key.fromMe) continue
        const jid = String(m.key.remoteJid ?? '')
        if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast')) continue
        const text = extractText(m)
        if (!text.trim()) continue
        pushMessage({
          id: String(m.key.id ?? `wa-in-${Date.now()}`),
          from: jid.split('@')[0] || jid,
          to: state.me?.phone ?? 'me',
          text,
          timestamp: Number(m.messageTimestamp ?? 0) * 1000 || Date.now(),
          direction: 'in',
        })
        log(`incoming message from ${jid}: ${text.slice(0, 60)}`)
      } catch (inner) {
        console.error('[wa] failed to process one message:', errMsg(inner))
      }
    }
  } catch (e) {
    console.error('[wa] messages.upsert handler failed:', errMsg(e))
  }
}

function wipeAuthState(): void {
  try {
    rmSync(AUTH_DIR, { recursive: true, force: true })
  } catch (e) {
    console.error('[wa] failed to wipe auth state:', errMsg(e))
  }
}

/** End the current baileys socket (if any) without touching ./auth-state. */
function stopReal(): void {
  clearWatchdog()
  const s = sock
  sock = null
  if (!s) {
    endChatSync('socket stopped')
    return
  }
  try { s.ev?.removeAllListeners?.('connection.update') } catch { /* ignore */ }
  try { s.ev?.removeAllListeners?.('messages.upsert') } catch { /* ignore */ }
  try { s.ev?.removeAllListeners?.('creds.update') } catch { /* ignore */ }
  try { s.ev?.removeAllListeners?.('messaging-history.set') } catch { /* ignore */ }
  try { s.ev?.removeAllListeners?.('contacts.upsert') } catch { /* ignore */ }
  try { s.ev?.removeAllListeners?.('contacts.update') } catch { /* ignore */ }
  try { s.end?.(new Error('stopped by service')) } catch { /* ignore */ }
  try { s.close?.() } catch { /* ignore */ }
  endChatSync('socket stopped')
}

// ---------------------------------------------------------------------------
// Self-memory guard (OOM safety net)
// ---------------------------------------------------------------------------
// History syncs (and pathological sessions) can balloon baileys' internals.
// Left unchecked, the kernel OOM-killer would target the LARGEST process on
// the box — the Next.js dev server — taking the whole CRM down whenever
// WhatsApp connects. Instead the connector polices itself: a soft recycle of
// the socket at 600MB, and a clean self-exit at 900MB (dev-alive.sh restarts
// the service within 45s; ./auth-state persists, so no re-scan is needed).

const CONNECTOR_SOFT_RSS = 600 * 1024 * 1024
const CONNECTOR_HARD_RSS = 900 * 1024 * 1024
let memGuardTimer: ReturnType<typeof setInterval> | null = null
let memRecycling = false

function selfMemoryGuard(): void {
  if (memGuardTimer) return
  memGuardTimer = setInterval(() => {
    try {
      const rss = process.memoryUsage.rss()
      if (rss > CONNECTOR_HARD_RSS) {
        console.error(`[wa] RSS ${(rss / 1048576).toFixed(0)}MB > hard cap — clean exit; supervisor will restart (auth state persists)`)
        try { persistMessages() } catch { /* ignore */ }
        try { persistChats() } catch { /* ignore */ }
        process.exit(0)
      }
      if (rss > CONNECTOR_SOFT_RSS && !memRecycling && state.mode === 'real') {
        memRecycling = true
        console.warn(`[wa] RSS ${(rss / 1048576).toFixed(0)}MB > soft cap — recycling the socket to release memory`)
        try { stopReal() } catch { /* ignore */ }
        setTimeout(() => {
          memRecycling = false
          void startReal().catch(() => {})
        }, 2_000)
      }
    } catch { /* ignore */ }
  }, 15_000)
}

/**
 * Start (or restart) real WhatsApp Web linking. If ./auth-state holds a valid
 * session, baileys reconnects WITHOUT emitting a QR; otherwise a QR appears
 * on /status within a few seconds.
 */
async function startReal(): Promise<WaStatusState> {
  clearDemoTimers()
  stopReal()
  state.mode = 'real'
  state.error = null
  state.qr = null
  state.me = null
  state.connectedAt = null
  state.status = 'scanning'
  log('starting real WhatsApp linking…')

  try {
    const B: any = await import('baileys')

    let auth: any
    try {
      // Aliased so the react-hooks lint rule does not mistake baileys'
      // `useMultiFileAuthState` for a React hook call.
      const openAuthState = B.useMultiFileAuthState
      auth = await openAuthState(AUTH_DIR)
    } catch (e) {
      throw new Error(`auth state init failed: ${errMsg(e)}`)
    }

    // Resolving the latest WA Web version needs network — cap it so a blocked
    // sandbox cannot stall linking; baileys falls back to its bundled version.
    let version: number[] | undefined
    try {
      const v: any = await Promise.race([
        B.fetchLatestBaileysVersion(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('version fetch timeout')), VERSION_TIMEOUT_MS),
        ),
      ])
      version = v?.version
    } catch {
      version = undefined
      log('fetchLatestBaileysVersion unavailable — using bundled default')
    }

    const s = B.makeWASocket({
      auth: auth.state,
      version,
      logger: silentLogger,
      browser: ['Unstop CRM (Web)', 'Chrome', '1.0.0'],
      connectTimeoutMs: 20_000,
      defaultQueryTimeoutMs: 30_000,
      markOnlineOnConnect: false,
      // CRITICAL (OOM fix): `syncFullHistory: true` made baileys download the
      // account's ENTIRE message archive on every fresh link. On this 4GB box
      // that ballooned the connector 500MB-1GB+ and the kernel OOM-killed the
      // largest process — next-server — so "the server goes down after
      // connecting WhatsApp". Recent history only; the CRM caps stored
      // messages at 200 anyway.
      syncFullHistory: false,
      // Second belt: refuse to buffer history blobs older than 30 days and
      // skip huge media-heavy protocol messages inside baileys' sync buffer.
      shouldSyncHistoryMessage: (msg: any): boolean => {
        try {
          const tsSec = Number(msg?.messageTimestamp ?? 0)
          if (tsSec > 0 && Date.now() / 1000 - tsSec > 30 * 24 * 60 * 60) return false
          return true
        } catch {
          return false
        }
      },
      // The CRM never asks baileys to re-decrypt old outgoing messages; a
      // stub avoids unbounded retry caches.
      getMessage: async () => undefined,
      printQRInTerminal: false,
    })
    sock = s

    s.ev.on('creds.update', auth.saveCreds)
    s.ev.on('connection.update', (u: any) => onConnectionUpdate(u))
    s.ev.on('messages.upsert', (u: any) => onMessagesUpsert(u))
    s.ev.on('messaging-history.set', (u: any) => onHistorySet(u))
    s.ev.on('contacts.upsert', (u: any) => onContactsUpsert(u))
    s.ev.on('contacts.update', (u: any) => onContactsUpsert(u))

    armWatchdog()
    log('baileys socket started; waiting for connection.update')
    return state.status
  } catch (e) {
    // baileys import/start failure (missing native deps, blocked install…):
    // degrade to a clean 'error' state — the HTTP service stays fully alive.
    state.status = 'error'
    state.error = `Failed to start WhatsApp linking: ${errMsg(e)}`
    sock = null
    clearWatchdog()
    console.error('[wa] startReal failed:', errMsg(e))
    return state.status
  }
}

// ---------------------------------------------------------------------------
// Endpoint handlers
// ---------------------------------------------------------------------------

function buildStatus(): Record<string, unknown> {
  const hasAuth = existsSync(path.join(AUTH_DIR, 'creds.json'))
  const hasDemo = existsSync(DEMO_SESSION_FILE)

  let qr: { dataUrl: string; expiresInSec: number } | null = null
  if (state.qr) {
    const remainingSec = Math.max(0, Math.ceil((QR_TTL_MS - (Date.now() - state.qr.createdAt)) / 1000))
    if (remainingSec > 0) qr = { dataUrl: state.qr.dataUrl, expiresInSec: remainingSec }
  }

  return {
    ok: true,
    mode: state.mode,
    status: state.status,
    hasPersistedSession: state.mode === 'demo' ? hasDemo : hasAuth,
    qr,
    me: state.me,
    connectedAt: state.connectedAt,
    // FIX 3 extras (additive — the original fields above are untouched).
    syncingChats,
    chatCount: chats.size,
    ...(pairingVisible ? { pairing: pairingVisible } : {}),
    ...(state.error ? { error: state.error } : {}),
  }
}

/** Pairing payload for /status — only while a code is live and unaccepted. */
function pairingVisible(): { code: string; phoneNumber: string; expiresInSec: number } | null {
  if (!pairing || state.status === 'connected') return null
  const remainingSec = Math.max(0, Math.ceil((PAIR_TTL_MS - (Date.now() - pairing.createdAt)) / 1000))
  if (remainingSec <= 0) return null
  return { code: pairing.code, phoneNumber: pairing.phoneNumber, expiresInSec: remainingSec }
}

async function handleStart(): Promise<{ ok: boolean; status: WaStatusState }> {
  // /start always targets REAL mode. If a demo session is active, it is
  // dropped first (demo state is disposable by design).
  if (state.mode === 'demo') {
    clearDemoTimers()
    try { rmSync(DEMO_SESSION_FILE, { force: true }) } catch { /* ignore */ }
  }
  if (state.mode === 'real' && state.status === 'connected' && sock) {
    log('/start while already connected — no-op')
    return { ok: true, status: state.status }
  }
  const status = await startReal()
  return { ok: true, status }
}

async function handleRefreshQr(): Promise<{ ok: boolean; status?: WaStatusState; error?: string }> {
  if (state.mode === 'demo') {
    return { ok: false, error: 'Demo mode is active — QR refresh applies to real linking only.' }
  }
  if (state.status === 'connected') {
    return { ok: false, error: 'Already connected — disconnect first to link a different device.' }
  }
  // Restart linking end-to-end so baileys emits a FRESH QR (old ones expire).
  const status = await startReal()
  return { ok: true, status }
}

async function handleDisconnect(): Promise<void> {
  if (state.mode === 'demo') {
    clearDemoTimers()
    try { rmSync(DEMO_SESSION_FILE, { force: true }) } catch { /* ignore */ }
    state.mode = 'real'
    state.status = 'disconnected'
    state.me = null
    state.connectedAt = null
    state.qr = null
    state.error = null
    log('demo session disconnected')
    return
  }

  clearPairing()
  const s = sock
  stopReal()
  if (s) {
    // logout() tells WhatsApp to drop the linked device. Network may be gone,
    // so cap it — the auth state is wiped below regardless.
    try {
      await Promise.race([
        s.logout(),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    } catch { /* ignore — offline logout is fine */ }
  }
  wipeAuthState()
  state.mode = 'real'
  state.status = 'disconnected'
  state.me = null
  state.connectedAt = null
  state.qr = null
  state.error = null
  log('real session disconnected — auth state wiped')
}

/**
 * POST /pair { phoneNumber } — link WITHOUT scanning a QR.
 * Validates the number, starts real-mode linking and asks baileys for an
 * 8-character pairing code. The code is also exposed via /status.pairing
 * (60s TTL, re-requestable) so the UI survives page refreshes.
 */
async function handlePair(rawPhone: string): Promise<{ ok: boolean; code?: string; status?: WaStatusState; error?: string; httpStatus?: number }> {
  const digits = String(rawPhone ?? '').replace(/[^0-9]/g, '')
  if (digits.length < 8 || digits.length > 15) {
    return { ok: false, error: 'Enter a valid phone number with country code', httpStatus: 400 }
  }
  if (state.status === 'connected') {
    const me = state.me?.phone ? `+${state.me.phone}` : 'a WhatsApp account'
    return { ok: false, error: `Already connected as ${me} — disconnect first to link a different number.`, httpStatus: 409 }
  }

  clearPairing()
  // /pair always targets REAL mode; a demo session is disposable by design.
  if (state.mode === 'demo') {
    try { rmSync(DEMO_SESSION_FILE, { force: true }) } catch { /* ignore */ }
  }

  const st = await startReal()
  if (st === 'error') {
    return { ok: false, error: state.error ?? 'Failed to start WhatsApp linking', httpStatus: 502 }
  }

  pendingPairNumber = digits
  log(`pairing requested for +${digits} — waiting for the socket handshake…`)

  // The pairing code needs the WA websocket to be up. Fast path: the first
  // QR event in onConnectionUpdate triggers runPairingRequest(). Fallback:
  // this driver retries every 1.5s (after ~6s it stops waiting for a QR) and
  // enforces the overall deadline.
  const deadline = Date.now() + 30_000
  try {
    const code = await new Promise<string>((resolve, reject) => {
      pairResolve = resolve
      pairReject = reject
      let ticks = 0
      pairDriver = setInterval(() => {
        ticks++
        if (!pendingPairNumber || pairing) {
          stopPairDriver()
          return
        }
        if (Date.now() >= deadline) {
          stopPairDriver()
          reject(new Error('Pairing timed out — request a new code'))
          return
        }
        if (sock && !pairInFlight && (state.qr || ticks >= 4)) void runPairingRequest()
      }, 1_500)
    })
    return { ok: true, code, status: state.status }
  } catch (e) {
    pendingPairNumber = null
    return { ok: false, error: errMsg(e) || 'Pairing request failed', httpStatus: 502 }
  }
}

async function handleSend(to: string, text: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const digits = String(to ?? '').replace(/[^0-9]/g, '')
  const body = String(text ?? '').trim().slice(0, 4_096)
  if (!digits) return { ok: false, error: 'A recipient phone number is required.' }
  if (!body) return { ok: false, error: 'Message text is required.' }

  // ---- Demo mode ----------------------------------------------------------
  if (state.mode === 'demo') {
    if (state.status !== 'connected') return { ok: false, error: 'Not connected.' }
    const id = `demo-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    pushMessage({
      id,
      from: state.me?.phone ?? DEMO_ME.phone,
      to: digits,
      text: body,
      timestamp: Date.now(),
      direction: 'out',
    })
    // The demo contact echoes the message back after ~1s.
    scheduleDemoIncoming(body)
    log(`demo outgoing to ${digits}: ${body.slice(0, 60)}`)
    return { ok: true, id }
  }

  // ---- Real mode ----------------------------------------------------------
  if (state.status !== 'connected' || !sock) {
    return { ok: false, error: 'WhatsApp is not connected — connect first.' }
  }
  try {
    const jid = `${digits}@s.whatsapp.net`
    const result: any = await Promise.race([
      sock.sendMessage(jid, { text: body }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`send timed out after ${SEND_TIMEOUT_MS / 1000}s`)), SEND_TIMEOUT_MS),
      ),
    ])
    const id = String(result?.key?.id ?? `wa-out-${Date.now()}`)
    pushMessage({
      id,
      from: state.me?.phone ?? 'me',
      to: digits,
      text: body,
      timestamp: Date.now(),
      direction: 'out',
    })
    log(`outgoing message to ${digits}: ${body.slice(0, 60)}`)
    return { ok: true, id }
  } catch (e) {
    console.error('[wa] send failed:', errMsg(e))
    return { ok: false, error: `Send failed: ${errMsg(e)}` }
  }
}

// ---------------------------------------------------------------------------
// HTTP server (bun.serve, port 3010)
// ---------------------------------------------------------------------------

/**
 * The gateway forwards browser calls like `/wa/status?XTransformPort=3010`.
 * Depending on its rewrite rules this service may see the full original path
 * or a stripped one — routing on the LAST path segment accepts both.
 */
function routeSegment(pathname: string): string {
  const clean = pathname.replace(/\/+$/, '')
  return (clean.split('/').pop() ?? '').toLowerCase()
}

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    // CORS pre-flight.
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const route = routeSegment(url.pathname)
    try {
      switch (route) {
        // ---- GET /health ---------------------------------------------------
        case 'health': {
          return json({ ok: true, service: SERVICE_NAME, port: PORT })
        }

        // ---- GET /status ---------------------------------------------------
        case 'status': {
          return json(buildStatus())
        }

        // ---- POST /start ---------------------------------------------------
        case 'start': {
          const r = await handleStart()
          return json(r)
        }

        // ---- POST /refresh-qr ----------------------------------------------
        case 'refresh-qr': {
          const r = await handleRefreshQr()
          return json(r, r.ok ? 200 : 409)
        }

        // ---- POST /disconnect ----------------------------------------------
        case 'disconnect': {
          await handleDisconnect()
          return json({ ok: true, status: 'disconnected' })
        }

        // ---- POST /demo-connect --------------------------------------------
        case 'demo-connect': {
          const r = demoConnect()
          return json(r, r.ok ? 200 : 409)
        }

        // ---- POST /pair { phoneNumber } -------------------------------------
        case 'pair': {
          const body = await readJson(req)
          const r = await handlePair(String(body?.phoneNumber ?? ''))
          return json({ ok: r.ok, code: r.code, status: r.status, error: r.error }, r.httpStatus ?? (r.ok ? 200 : 400))
        }

        // ---- GET /chats?limit= ----------------------------------------------
        case 'chats': {
          const raw = Number(url.searchParams.get('limit') ?? '100')
          const limit = Math.max(1, Number.isFinite(raw) ? Math.min(500, raw) : 100)
          return json({ ok: true, chats: sortedChats(limit) })
        }

        // ---- POST /chats/read { peer } ----------------------------------------
        case 'read': {
          const body = await readJson(req)
          const r = handleChatsRead(String(body?.peer ?? ''))
          return json(r, r.ok ? 200 : 404)
        }

        // ---- GET /messages?limit=50[&peer=<jid>] -----------------------------
        case 'messages': {
          const raw = Number(url.searchParams.get('limit') ?? '50')
          const limit = Math.min(MESSAGE_CAP, Math.max(1, Number.isFinite(raw) ? raw : 50))
          const peerDigits = (url.searchParams.get('peer') ?? '').replace(/[^0-9]/g, '')
          if (peerDigits) return json({ ok: true, messages: messagesForPeer(peerDigits, limit) })
          return json({ ok: true, messages: recentMessages(limit) })
        }

        // ---- POST /send { to, text } ---------------------------------------
        case 'send': {
          const body = await readJson(req)
          const r = await handleSend(String(body?.to ?? ''), String(body?.text ?? ''))
          return json(r, r.ok ? 200 : 400)
        }

        default:
          return json({ ok: false, error: `Unknown route '${route}'` }, 404)
      }
    } catch (e) {
      // Last-resort guard: no request may ever take the service down.
      console.error('[wa] request handler failed:', errMsg(e))
      return json({ ok: false, error: `Internal error: ${errMsg(e)}` }, 500)
    }
  },
  error(err: unknown): Response {
    console.error('[wa] bun.serve error:', err instanceof Error ? err.message : err)
    return json({ ok: false, error: 'Internal error' }, 500)
  },
})

// ---------------------------------------------------------------------------
// Boot + crash guards + graceful shutdown
// ---------------------------------------------------------------------------

process.on('uncaughtException', (err) => {
  console.error('[wa] uncaughtException (service kept alive):', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[wa] unhandledRejection (service kept alive):', reason)
})

loadMessages()
loadChats()
selfMemoryGuard()

if (!restoreDemoSession() && existsSync(path.join(AUTH_DIR, 'creds.json'))) {
  // Persisted real session → reconnect WITHOUT a re-scan (baileys native).
  log('persisted auth state found — auto-reconnecting')
  void startReal()
}

log(`listening on port ${PORT}`)
log(`health:  GET  http://localhost:${PORT}/health`)
log(`status:  GET  http://localhost:${PORT}/status  (browser: fetch('/wa/status?XTransformPort=3010'))`)

function shutdown(signal: string): void {
  log(`received ${signal}, shutting down…`)
  try { clearDemoTimers() } catch { /* ignore */ }
  try { stopReal() } catch { /* ignore */ }
  try { server.stop(true) } catch { /* ignore */ }
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
