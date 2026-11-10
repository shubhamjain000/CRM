import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server'
import { db } from '@/lib/db'

const rpName = 'Foundation'

// WebAuthn hard requirement: the RP ID must EQUAL (or be a registrable suffix
// of) the hostname the browser is actually on, and the expected origin must
// match the browser's origin. A hardcoded "localhost" RP therefore breaks the
// moment the app is opened through any other host (preview domain, LAN IP,
// production domain) — `navigator.credentials.create()` throws SecurityError
// and passkeys "don't work". We now derive the RP context from the incoming
// request headers (set by the gateway/CDN: x-forwarded-host / x-forwarded-proto).
export interface WebAuthnContext {
  rpID: string
  expectedOrigins: string[]
}

/** Host header may be "host:port" or a comma list from chained proxies. */
function firstHost(value: string | null): string | null {
  if (!value) return null
  return value.split(',')[0]?.trim() || null
}

/** Header-derived context (fallback when the client doesn't declare its origin). */
function contextFromHeaders(req: Request): WebAuthnContext {
  const fwdHost = firstHost(req.headers.get('x-forwarded-host'))
  const host = firstHost(req.headers.get('host'))
  const effectiveHost = fwdHost || host || 'localhost'
  // RP ID is a registrable hostname — NEVER include the port.
  const rpID = effectiveHost.replace(/:\d+$/, '').toLowerCase() || 'localhost'
  const proto = (req.headers.get('x-forwarded-proto') ?? 'http').split(',')[0]?.trim() || 'http'
  const isLocal = rpID === 'localhost' || rpID === '127.0.0.1'

  const origins = new Set<string>()
  // Primary candidate: the exact origin the browser used.
  origins.add(`${proto}://${effectiveHost}`)
  // Scheme mismatch safety (proxy terminates TLS but forwards http, or the app
  // is reachable both ways).
  origins.add(proto === 'https' ? `http://${effectiveHost}` : `https://${effectiveHost}`)
  // Bare-host variants (default ports elided by the browser).
  origins.add(`${proto}://${rpID}`)
  // Local development fallbacks so the dev server keeps working unchanged.
  if (isLocal) {
    origins.add('http://localhost:3000')
    origins.add('http://127.0.0.1:3000')
    origins.add(`http://${host ?? 'localhost:3000'}`)
  }
  return { rpID, expectedOrigins: [...origins] }
}

/** Validate a client-declared origin string ("https://host[:port]"). */
function parseClientOrigin(value: unknown): URL | null {
  if (typeof value !== 'string' || !value || value.length > 200) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname) return null
    return url
  } catch {
    return null
  }
}

export function webauthnContextFromRequest(req: Request, clientOrigin?: unknown): WebAuthnContext {
  // Prefer the origin the BROWSER reports (window.location.origin, sent by the
  // client): behind gateways/preview proxies the forwarded Host headers can name
  // an internal deployment host (e.g. "*.fcapp.run"), while WebAuthn hard-requires
  // the RP ID to match the domain the browser is actually on — otherwise
  // navigator.credentials throws "The RP ID ... is invalid for this domain".
  // This is safe: the browser itself enforces the origin↔RP ID binding on every
  // create()/get() call, and verification pins expectedRPID to the same value.
  const declared = parseClientOrigin(clientOrigin)
  if (declared) {
    const rpID = declared.hostname.toLowerCase()
    const isLocal = rpID === 'localhost' || rpID === '127.0.0.1'
    const origins = new Set<string>()
    // Primary: the exact origin the browser is on (no trailing slash).
    origins.add(declared.origin)
    // Scheme-mismatch safety (proxy TLS vs app http, default-port elision).
    origins.add(declared.protocol === 'https:' ? `http://${declared.host}` : `https://${declared.host}`)
    origins.add(`${declared.protocol}//${rpID}`)
    if (isLocal) {
      origins.add('http://localhost:3000')
      origins.add('http://127.0.0.1:3000')
    }
    // Defensive union with header-derived candidates.
    for (const o of contextFromHeaders(req).expectedOrigins) origins.add(o)
    return { rpID, expectedOrigins: [...origins] }
  }
  return contextFromHeaders(req)
}

export async function createRegistrationChallenge(
  userId: string,
  email: string,
  ctx: WebAuthnContext,
) {
  const existing = await db.webAuthnCredential.findMany({ where: { userId } })
  const options = await generateRegistrationOptions({
    rpName,
    rpID: ctx.rpID,
    userID: new TextEncoder().encode(userId),
    userName: email,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      type: 'public-key',
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  await db.passkeyChallenge.create({
    data: { userId, challenge: options.challenge, type: 'registration' },
  })

  return options as PublicKeyCredentialCreationOptionsJSON
}

export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  name: string,
  ctx: WebAuthnContext,
) {
  const challenge = await db.passkeyChallenge.findFirst({
    where: { userId, type: 'registration' },
    orderBy: { createdAt: 'desc' },
  })
  if (!challenge) throw new Error('No active registration challenge')

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: ctx.expectedOrigins,
    expectedRPID: ctx.rpID,
  })

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Registration verification failed')
  }

  const { credential } = verification.registrationInfo
  await db.webAuthnCredential.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: JSON.stringify(credential.transports ?? []),
      name: name || 'Passkey',
    },
  })

  await db.passkeyChallenge.deleteMany({ where: { userId, type: 'registration' } })
  return { verified: true }
}

export async function createAuthenticationChallenge(email: string, ctx: WebAuthnContext) {
  const user = await db.user.findUnique({ where: { email } })
  if (!user) throw new Error('User not found')

  const creds = await db.webAuthnCredential.findMany({ where: { userId: user.id } })
  if (creds.length === 0) throw new Error('No passkeys registered')

  const options = await generateAuthenticationOptions({
    rpID: ctx.rpID,
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      type: 'public-key',
      transports: (JSON.parse(c.transports) as string[]) ?? [],
    })),
    userVerification: 'preferred',
  })

  await db.passkeyChallenge.create({
    data: { userId: user.id, challenge: options.challenge, type: 'authentication' },
  })

  return options as PublicKeyCredentialRequestOptionsJSON
}

export async function verifyAuthentication(
  email: string,
  response: AuthenticationResponseJSON,
  ctx: WebAuthnContext,
) {
  const user = await db.user.findUnique({ where: { email } })
  if (!user) throw new Error('User not found')

  const challenge = await db.passkeyChallenge.findFirst({
    where: { userId: user.id, type: 'authentication' },
    orderBy: { createdAt: 'desc' },
  })
  if (!challenge) throw new Error('No active auth challenge')

  const credential = await db.webAuthnCredential.findUnique({
    where: { credentialId: response.id },
  })
  if (!credential) throw new Error('Unknown credential')

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: ctx.expectedOrigins,
    expectedRPID: ctx.rpID,
    credential: {
      id: credential.credentialId,
      publicKey: Buffer.from(credential.publicKey, 'base64url'),
      counter: credential.counter,
      transports: (JSON.parse(credential.transports) as string[]) ?? [],
    },
  })

  if (!verification.verified) throw new Error('Authentication verification failed')

  await db.webAuthnCredential.update({
    where: { id: credential.id },
    data: { counter: verification.authenticationInfo.newCounter },
  })
  await db.passkeyChallenge.deleteMany({ where: { userId: user.id, type: 'authentication' } })

  return { userId: user.id, verified: true }
}
