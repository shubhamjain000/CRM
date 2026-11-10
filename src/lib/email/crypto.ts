import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'

/**
 * At-rest encryption for EmailAccount OAuth/app-password credentials.
 *
 * Format: `enc:v1:<ivB64>:<tagB64>:<ctB64>` (AES-256-GCM, random 12-byte IV,
 * 16-byte auth tag). Anything that does NOT start with `enc:v1:` is treated as
 * legacy plaintext JSON and passed straight through `JSON.parse` — this is what
 * keeps credentials stored before this change working with zero migration.
 *
 * Key resolution:
 *  1. `process.env.EMAIL_TOKEN_KEY` when set — sha256'd to a stable 32-byte key
 *     (so any passphrase length works and the raw secret is never used directly).
 *  2. Otherwise a stable per-install random key persisted in the KVStore table
 *     under (organizationId='system', key='email_token_key'). KVStore rows are
 *     keyed by the `organizationId_key` unique compound (same access pattern as
 *     the Google OAuth flow state in the authorize route); 'system' is a fixed
 *     sentinel org id because this key is intentionally global, not per-org.
 *
 * The resolved key is cached in module scope, so the KVStore is hit at most once
 * per server process (and never again when EMAIL_TOKEN_KEY is configured).
 */

const KV_ORGANIZATION_ID = 'system'
const KV_KEY = 'email_token_key'
const PREFIX = 'enc:v1:'

let cachedKey: Buffer | null = null
let keyPromise: Promise<Buffer> | null = null

/** Resolve (and cache) the 32-byte token-encryption key. Concurrent calls share one promise. */
export async function getEmailTokenKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey
  if (!keyPromise) {
    keyPromise = (async () => {
      const envKey = process.env.EMAIL_TOKEN_KEY?.trim()
      if (envKey) {
        cachedKey = createHash('sha256').update(envKey).digest()
        return cachedKey
      }
      const row = await db.kVStore.findUnique({
        where: { organizationId_key: { organizationId: KV_ORGANIZATION_ID, key: KV_KEY } },
        select: { value: true },
      })
      if (row && /^[0-9a-f]{64}$/i.test(row.value)) {
        cachedKey = Buffer.from(row.value, 'hex')
        return cachedKey
      }
      const generated = randomBytes(32)
      await db.kVStore.upsert({
        where: { organizationId_key: { organizationId: KV_ORGANIZATION_ID, key: KV_KEY } },
        create: { organizationId: KV_ORGANIZATION_ID, key: KV_KEY, value: generated.toString('hex') },
        update: {},
      })
      cachedKey = generated
      return cachedKey
    })().catch((e) => {
      keyPromise = null // allow a retry on the next call
      throw e
    })
  }
  return keyPromise
}

/** Pre-warm the key cache before synchronous readers (parseCredentials) run. */
export async function ensureEmailTokenKey(): Promise<void> {
  try {
    await getEmailTokenKey()
  } catch {
    // Best-effort: readers degrade to legacy-passthrough behavior on failure.
  }
}

// Fire-and-forget warm-up so long-lived processes almost always have the key
// cached by the time any request touches credentials.
void ensureEmailTokenKey()

/** Core AES-256-GCM decrypt. Throws when the auth tag does not verify. */
function decryptWithKey(payload: string, key: Buffer): unknown {
  const parts = payload.slice(PREFIX.length).split(':')
  if (parts.length !== 3) throw new Error('Malformed encrypted payload')
  const [ivB64, tagB64, ctB64] = parts
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf-8'))
}

/** Encrypt any JSON-serializable value → `enc:v1:<ivB64>:<tagB64>:<ctB64>`. */
export async function encryptJson(obj: unknown): Promise<string> {
  const key = await getEmailTokenKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj ?? {}), 'utf-8'), cipher.final()])
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}

/**
 * Decrypt a stored credential string (async). `enc:v1:` payloads are decrypted
 * with the auth tag verified (throws on tamper/key mismatch); anything else is
 * legacy plaintext JSON passed through unchanged so pre-existing accounts keep
 * working.
 */
export async function decryptJson(s: string): Promise<any> {
  const raw = typeof s === 'string' ? s.trim() : ''
  if (!raw.startsWith(PREFIX)) return JSON.parse(raw)
  return decryptWithKey(raw, await getEmailTokenKey())
}

/**
 * Synchronous variant used by callers that must stay sync (e.g. the exported
 * `parseCredentials` in google.ts, which other modules already call without
 * await). Uses the cached key only — call `ensureEmailTokenKey()` first when on
 * a fresh code path. Non-encrypted input still passes through as legacy JSON.
 */
export function decryptJsonSync(s: string): any {
  const raw = typeof s === 'string' ? s.trim() : ''
  if (!raw.startsWith(PREFIX)) return JSON.parse(raw)
  if (!cachedKey) throw new Error('Email token key not initialized yet')
  return decryptWithKey(raw, cachedKey)
}
