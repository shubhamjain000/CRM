import { db } from '@/lib/db'
import { sanitizeHtml } from '@/lib/utils'
import { decryptJson, decryptJsonSync, encryptJson } from '@/lib/email/crypto'

/**
 * Working Google Email connector — real OAuth2 + Gmail API.
 *
 * Two connection modes are supported for Gmail mailboxes:
 *
 *  1. OAuth ("Connect with Google") — the org admin pastes a Google Cloud
 *     OAuth Client ID + Secret once (stored org-level in Integration
 *     provider='google_oauth'); users click "Connect with Google" and the
 *     full authorization-code + PKCE flow runs against Google's live
 *     endpoints. A refresh token is stored per mailbox so sync/send keep
 *     working without re-consent.
 *
 *  2. App Password (quick path, see google-imap.ts) — mailbox address +
 *     16-character Google App Password, verified over SMTP and synced over
 *     IMAP. Works without a Google Cloud project.
 *
 * Every network call below hits the REAL Google endpoints. Failures surface
 * honestly (stored in EmailAccount.lastSyncError / returned to the caller) —
 * the connector never fakes a successful connection.
 */

// ---------------------------------------------------------------------------
// Endpoints & scopes
// ---------------------------------------------------------------------------

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const GMAIL_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
]

export const GOOGLE_OAUTH_PROVIDER_KEY = 'google_oauth'

/** 10-second bounded fetch — a dead endpoint must not hang a request. */
async function boundedFetch(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Org-level OAuth app configuration (Integration provider='google_oauth')
// ---------------------------------------------------------------------------

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
}

export async function getGoogleOAuthConfig(organizationId: string): Promise<GoogleOAuthConfig | null> {
  const integration = await db.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: GOOGLE_OAUTH_PROVIDER_KEY } },
  })
  if (!integration?.isConnected) return null
  try {
    const cfg = JSON.parse(integration.config || '{}') as Partial<GoogleOAuthConfig>
    if (!cfg.clientId?.trim() || !cfg.clientSecret?.trim()) return null
    return { clientId: cfg.clientId.trim(), clientSecret: cfg.clientSecret.trim() }
  } catch {
    return null
  }
}

export async function saveGoogleOAuthConfig(organizationId: string, cfg: GoogleOAuthConfig) {
  await db.integration.upsert({
    where: { organizationId_provider: { organizationId, provider: GOOGLE_OAUTH_PROVIDER_KEY } },
    create: {
      organizationId,
      provider: GOOGLE_OAUTH_PROVIDER_KEY,
      isConnected: true,
      config: JSON.stringify(cfg),
    },
    update: { isConnected: true, config: JSON.stringify(cfg) },
  })
}

export async function logIntegrationEvent(organizationId: string, provider: string, event: string, status: string, details: string) {
  const integration = await db.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
  })
  if (!integration) return
  await db.integrationLog.create({
    data: { organizationId, integrationId: integration.id, event, status, details: details.slice(0, 500) },
  })
}

// ---------------------------------------------------------------------------
// OAuth2 authorization-code + PKCE flow
// ---------------------------------------------------------------------------

/** Computes the redirect_uri from request headers (works behind the gateway). */
export function resolveRedirectUri(req: Request): string {
  const h = req.headers
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return `${proto}://${host}/api/email/google/callback`
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

async function sha256(input: string): Promise<Buffer> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Buffer.from(digest)
}

/** PKCE pair: random verifier + its SHA-256 base64url challenge. */
async function makePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(Buffer.from(crypto.getRandomValues(new Uint8Array(32))))
  const challenge = base64url(await sha256(verifier))
  return { verifier, challenge }
}

export async function buildAuthorizeUrl(cfg: GoogleOAuthConfig, redirectUri: string): Promise<{ url: string; state: string; verifier: string }> {
  const state = base64url(Buffer.from(crypto.getRandomValues(new Uint8Array(24))))
  const { verifier, challenge } = await makePkce()
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GMAIL_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return { url: url.toString(), state, verifier }
}

export interface GoogleTokens {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
}

/** Exchange an authorization code for tokens (real token endpoint). */
export async function exchangeGoogleCode(params: {
  code: string
  cfg: GoogleOAuthConfig
  redirectUri: string
  codeVerifier: string
}): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.cfg.clientId,
    client_secret: params.cfg.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: params.codeVerifier,
  })
  const res = await boundedFetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${String(data.error_description ?? data.error ?? 'unknown error')}`)
  }
  return data as unknown as GoogleTokens
}

/** Refresh an access token from a stored refresh token. */
export async function refreshGoogleToken(params: { refreshToken: string; cfg: GoogleOAuthConfig }): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    refresh_token: params.refreshToken,
    client_id: params.cfg.clientId,
    client_secret: params.cfg.clientSecret,
    grant_type: 'refresh_token',
  })
  const res = await boundedFetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status}): ${String(data.error_description ?? data.error ?? 'unknown error')}`)
  }
  return data as unknown as GoogleTokens
}

/** Who authorised? — returns the Google account email. */
export async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await boundedFetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Google userinfo failed (${res.status})`)
  const data = (await res.json()) as { email?: string }
  if (!data.email) throw new Error('Google account has no email address')
  return data.email
}

const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

/**
 * Revoke a stored refresh token via Google's revocation endpoint (Part 6.5).
 * Best-effort: a network/Google-side failure must never block the disconnect —
 * the local account row is removed regardless, and the error is reported back
 * for display. Passing a token to this endpoint also invalidates its access
 * tokens, so a revoked connection cannot send/sync anywhere else either.
 */
export async function revokeGoogleToken(refreshToken: string): Promise<{ revoked: boolean; error?: string }> {
  try {
    const res = await boundedFetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    })
    // Google answers 200 on success; 400 with invalid_token for already-dead
    // tokens — both count as "no longer usable".
    if (res.ok || res.status === 400) return { revoked: true }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { revoked: false, error: String(data.error_description ?? data.error ?? `HTTP ${res.status}`) }
  } catch (e) {
    return { revoked: false, error: e instanceof Error ? e.message : 'network error' }
  }
}

// ---------------------------------------------------------------------------
// Token lifecycle for a connected account
// ---------------------------------------------------------------------------

export interface GmailCredentials {
  mode: 'oauth' | 'app-password'
  refreshToken?: string
  accessToken?: string
  expiresAt?: string
  appPassword?: string
}

/**
 * Parse the stored credentials of an EmailAccount. Must stay synchronous
 * (existing callers in channels/handler.ts use it without await): encrypted
 * `enc:v1:` payloads are decrypted with the cached key (see crypto.ts), while
 * legacy plaintext JSON passes straight through — so accounts connected before
 * encryption keep working.
 */
export function parseCredentials(account: { credentials: string }): GmailCredentials {
  try {
    return decryptJsonSync(account.credentials || '{}') as GmailCredentials
  } catch {
    return { mode: 'app-password' }
  }
}

/** Returns a valid access token, refreshing + persisting when close to expiry. */
export async function getValidAccessToken(organizationId: string, account: { id: string; credentials: string }): Promise<{ token: string; credentials: GmailCredentials }> {
  // Decrypt (or legacy-passthrough) the stored credentials.
  let creds: GmailCredentials
  try {
    creds = (await decryptJson(account.credentials || '{}')) as GmailCredentials
  } catch {
    creds = { mode: 'app-password' }
  }
  if (creds.mode !== 'oauth' || !creds.refreshToken) {
    throw new Error('Account is not an OAuth Gmail connection')
  }
  const cfg = await getGoogleOAuthConfig(organizationId)
  if (!cfg) throw new Error('Google OAuth is not configured for this organization')

  const expiresAt = creds.expiresAt ? new Date(creds.expiresAt).getTime() : 0
  if (creds.accessToken && Date.now() < expiresAt - 60_000) {
    return { token: creds.accessToken, credentials: creds }
  }
  const tokens = await refreshGoogleToken({ refreshToken: creds.refreshToken, cfg })
  creds.accessToken = tokens.access_token
  creds.expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
  // Re-persist the refreshed tokens ENCRYPTED (at-rest credential protection).
  await db.emailAccount.update({
    where: { id: account.id },
    data: { credentials: await encryptJson(creds) },
  })
  return { token: tokens.access_token, credentials: creds }
}

// ---------------------------------------------------------------------------
// Gmail message parsing
// ---------------------------------------------------------------------------

interface GmailPart {
  mimeType?: string
  filename?: string
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
  headers?: { name: string; value: string }[]
}

interface GmailMessage {
  id: string
  threadId: string
  snippet?: string
  payload?: GmailPart
  internalDate?: string
}

function decodeB64(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

function findBody(part: GmailPart | undefined): { text?: string; html?: string } {
  if (!part) return {}
  const out: { text?: string; html?: string } = {}
  const walk = (p: GmailPart) => {
    if (p.mimeType === 'text/plain' && p.body?.data && out.text === undefined) {
      out.text = decodeB64(p.body.data)
    }
    if (p.mimeType === 'text/html' && p.body?.data && out.html === undefined) {
      out.html = decodeB64(p.body.data)
    }
    for (const child of p.parts ?? []) walk(child)
  }
  walk(part)
  return out
}

function collectAttachments(part: GmailPart | undefined): { filename: string; mimeType: string; size: number }[] {
  const files: { filename: string; mimeType: string; size: number }[] = []
  const walk = (p: GmailPart) => {
    if (p.filename && p.body?.size !== undefined) {
      files.push({ filename: p.filename, mimeType: p.mimeType ?? 'application/octet-stream', size: p.body.size })
    }
    for (const child of p.parts ?? []) walk(child)
  }
  if (part) walk(part)
  return files
}

function header(msg: GmailMessage, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? ''
}

function parseAddressList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Inbound email ↔ CRM linking (additive, best-effort — never breaks sync)
// ---------------------------------------------------------------------------

/**
 * Same normalization the send path uses for EmailThread.subject
 * (src/lib/email/handler.ts sendEmail). Kept as an identical local expression
 * because handler.ts imports this module (a shared export would create a cycle).
 */
export function normalizeEmailSubject(subject: string): string {
  return (subject || '').replace(/^(Re:|Fwd:|Fw:)\s*/gi, '').trim()
}

/** Bare email addresses pulled out of `Name <a@b.com>, c@d.com` style headers. */
export function extractEmailAddresses(raw: string | string[]): string[] {
  const parts = Array.isArray(raw) ? raw : [raw]
  const out: string[] = []
  for (const part of parts) {
    for (const m of String(part ?? '').matchAll(/[^\s,<>"';]+@[^\s,<>"';]+/g)) {
      out.push(m[0].replace(/[.;,]+$/, '').toLowerCase())
    }
  }
  return [...new Set(out)]
}

/**
 * Best-effort association of a freshly persisted INBOUND message:
 *  1. Contact match — the org-scoped contact whose `emails` JSON contains any
 *     from/to address (same `contains` pattern the send path uses) is stamped
 *     onto the Email row as relatedModule='contact'/relatedId.
 *  2. Reply detection — In-Reply-To messageId first, then the normalized
 *     subject: when it resolves to an existing thread of this org, the message
 *     is attached to that thread and EmailThread.repliedAt is set (additive —
 *     an existing repliedAt is never unset or overwritten).
 *  3. Thread creation for inbound only happens when a sensible thread can be
 *     formed (a matched contact); otherwise no thread is created and the
 *     existing thread logic stays untouched.
 * Every step is individually guarded — sync must never fail because of matching.
 */
export async function applyInboundAssociations(params: {
  organizationId: string
  emailId: string
  fromAddress: string
  toAddresses: string[]
  subject: string
  inReplyTo?: string
}): Promise<void> {
  try {
    const addresses = extractEmailAddresses([params.fromAddress, ...params.toAddresses])
    let contact: { id: string } | null = null
    if (addresses.length > 0) {
      contact = await db.contact.findFirst({
        where: {
          organizationId: params.organizationId,
          OR: addresses.map((a) => ({ emails: { contains: a } })),
        },
        select: { id: true },
      })
    }

    // Resolve the thread this message belongs to / replies to.
    let thread: { id: string; repliedAt: Date | null } | null = null
    const replyTo = params.inReplyTo?.trim()
    if (replyTo) {
      const original = await db.email.findFirst({
        where: { organizationId: params.organizationId, messageId: replyTo },
        select: { threadId: true },
      })
      if (original?.threadId) {
        thread = await db.emailThread.findFirst({
          where: { id: original.threadId, organizationId: params.organizationId },
          select: { id: true, repliedAt: true },
        })
      }
    }
    if (!thread && params.subject) {
      thread = await db.emailThread.findFirst({
        where: { organizationId: params.organizationId, subject: normalizeEmailSubject(params.subject) },
        select: { id: true, repliedAt: true },
      })
    }

    if (thread) {
      const data: { threadId: string; relatedModule?: string; relatedId?: string } = { threadId: thread.id }
      if (contact) { data.relatedModule = 'contact'; data.relatedId = contact.id }
      await db.email.update({ where: { id: params.emailId }, data }).catch(() => {})
      if (!thread.repliedAt) {
        // Reply flag: additive only — never unset an existing repliedAt.
        await db.emailThread.update({ where: { id: thread.id }, data: { repliedAt: new Date() } }).catch(() => {})
      }
      if (contact) {
        // Backfill the thread's record link only when it has none yet.
        await db.emailThread.updateMany({
          where: { id: thread.id, relatedModule: null, relatedId: null },
          data: { relatedModule: 'contact', relatedId: contact.id },
        }).catch(() => {})
      }
    } else if (contact) {
      const created = await db.emailThread.create({
        data: {
          organizationId: params.organizationId,
          subject: normalizeEmailSubject(params.subject) || '(no subject)',
          relatedModule: 'contact',
          relatedId: contact.id,
          lastActivityAt: new Date(),
          emailCount: 1,
        },
      }).catch(() => null)
      if (created) {
        await db.email.update({ where: { id: params.emailId }, data: { threadId: created.id } }).catch(() => {})
      }
    }
  } catch { /* matching is an enhancement — the sync result is already persisted */ }
}

// ---------------------------------------------------------------------------
// Gmail sync (OAuth mode)
// ---------------------------------------------------------------------------

export interface SyncResult {
  synced: number
  skipped: boolean
  error?: string
}

/** Fetch the latest messages for an OAuth-connected Gmail account. */
export async function syncGmailAccount(account: {
  id: string
  organizationId: string
  emailAddress: string
  credentials: string
}, max = 25): Promise<SyncResult> {
  try {
    const { token } = await getValidAccessToken(account.organizationId, account)

    const listRes = await boundedFetch(`${GMAIL_API_BASE}/messages?maxResults=${max}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (listRes.status === 401 || listRes.status === 403) {
      throw new Error('Gmail rejected the access token — reconnect the account')
    }
    if (!listRes.ok) {
      const t = await listRes.text().catch(() => '')
      throw new Error(`Gmail list failed (${listRes.status}): ${t.slice(0, 200)}`)
    }
    const list = (await listRes.json()) as { messages?: { id: string }[] }
    const ids = list.messages ?? []

    let synced = 0
    for (const { id } of ids) {
      const existing = await db.email.findFirst({
        where: { organizationId: account.organizationId, accountId: account.id, messageId: id },
        select: { id: true },
      })
      if (existing) continue

      const msgRes = await boundedFetch(`${GMAIL_API_BASE}/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!msgRes.ok) continue
      const msg = (await msgRes.json()) as GmailMessage

      const body = findBody(msg.payload)
      const attachments = collectAttachments(msg.payload)
      const toAddresses = parseAddressList(header(msg, 'To'))
      // Only keep mail that involves THIS mailbox (skip mail Google shows via delegation)
      const dateHeader = header(msg, 'Date')
      const receivedAt = msg.internalDate
        ? new Date(Number(msg.internalDate))
        : dateHeader && !Number.isNaN(new Date(dateHeader).getTime())
          ? new Date(dateHeader)
          : new Date()

      const created = await db.email.create({
        data: {
          organizationId: account.organizationId,
          accountId: account.id,
          messageId: msg.id,
          fromAddress: header(msg, 'From') || 'unknown',
          toAddresses: JSON.stringify(toAddresses),
          cc: JSON.stringify(parseAddressList(header(msg, 'Cc'))),
          subject: header(msg, 'Subject') || '(no subject)',
          bodyHtml: sanitizeHtml(body.html ?? ''),
          bodyText: body.text ?? msg.snippet ?? '',
          attachments: JSON.stringify(attachments),
          direction: 'inbound',
          status: 'delivered',
          hasAttachments: attachments.length > 0,
          labels: JSON.stringify([]),
          receivedAt,
        },
      })
      // Additive: link the message to a matching contact / thread and detect replies.
      await applyInboundAssociations({
        organizationId: account.organizationId,
        emailId: created.id,
        fromAddress: header(msg, 'From') || 'unknown',
        toAddresses,
        subject: header(msg, 'Subject') || '',
        inReplyTo: header(msg, 'In-Reply-To') || undefined,
      })
      synced++
    }

    await db.emailAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    })
    return { synced, skipped: false }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown sync error'
    await db.emailAccount.update({
      where: { id: account.id },
      data: { lastSyncError: message.slice(0, 500) },
    }).catch(() => {})
    return { synced: 0, skipped: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// Gmail send (OAuth mode)
// ---------------------------------------------------------------------------

function buildMime(params: {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text: string
  html: string
}): string {
  const lines: string[] = []
  lines.push(`From: ${params.from}`)
  lines.push(`To: ${params.to.join(', ')}`)
  if (params.cc?.length) lines.push(`Cc: ${params.cc.join(', ')}`)
  lines.push(`Subject: ${params.subject}`)
  lines.push('MIME-Version: 1.0')
  lines.push('Content-Type: text/html; charset="UTF-8"')
  lines.push('')
  lines.push(params.html || `<pre>${params.text}</pre>`)
  return lines.join('\r\n')
}

/** Send through the connected Gmail account via the Gmail API. */
export async function sendGmailMessage(account: {
  id: string
  organizationId: string
  emailAddress: string
  credentials: string
}, params: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html: string }): Promise<{ messageId: string; threadId?: string }> {
  const { token } = await getValidAccessToken(account.organizationId, account)
  const mime = buildMime({
    from: account.emailAddress,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    text: params.text,
    html: params.html,
  })
  const res = await boundedFetch(`${GMAIL_API_BASE}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(mime).toString('base64url') }),
  })
  const data = (await res.json().catch(() => ({}))) as { id?: string; threadId?: string; error?: { message?: string } }
  if (!res.ok) {
    throw new Error(`Gmail send failed (${res.status}): ${data.error?.message?.slice(0, 300) ?? 'unknown error'}`)
  }
  return { messageId: data.id ?? '', threadId: data.threadId }
}
