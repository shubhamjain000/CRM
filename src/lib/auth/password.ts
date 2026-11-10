import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

const BCRYPT_ROUNDS = 12

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

const COMPLEXITY = {
  minLength: 10,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: true,
}

export interface PasswordPolicyResult {
  ok: boolean
  reasons: string[]
}

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const reasons: string[] = []
  if (password.length < COMPLEXITY.minLength)
    reasons.push(`At least ${COMPLEXITY.minLength} characters`)
  if (COMPLEXITY.requireUpper && !/[A-Z]/.test(password)) reasons.push('An uppercase letter')
  if (COMPLEXITY.requireLower && !/[a-z]/.test(password)) reasons.push('A lowercase letter')
  if (COMPLEXITY.requireDigit && !/\d/.test(password)) reasons.push('A number')
  if (COMPLEXITY.requireSymbol && !/[^A-Za-z0-9]/.test(password)) reasons.push('A symbol')
  return { ok: reasons.length === 0, reasons }
}

export async function isPasswordReused(userId: string, plain: string): Promise<boolean> {
  const history = await db.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  for (const h of history) {
    if (await bcrypt.compare(plain, h.passwordHash)) return true
  }
  return false
}

export async function isPasswordBreached(password: string): Promise<boolean> {
  try {
    const { createHash } = await import('crypto')
    const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
    const prefix = sha1.slice(0, 5)
    const suffix = sha1.slice(5)
    // Hard 2.5s deadline: in restricted-network environments (sandboxed
    // previews) an untimed fetch could hang for tens of seconds and make
    // SIGN UP look frozen. Fail-open — availability beats the check.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    let res: Response
    try {
      res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return false
    const text = await res.text()
    return text.split('\n').some((line) => line.trim().startsWith(suffix))
  } catch {
    return false
  }
}
