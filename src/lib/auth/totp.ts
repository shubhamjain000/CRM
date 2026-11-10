import * as OTPAuth from 'otpauth'
import { db } from '@/lib/db'

const ISSUER = 'Foundation'

export function generateTotpSecret(email: string): { secret: string; uri: string } {
  const secret = new OTPAuth.Secret({ size: 20 })
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  })
  return { secret: secret.base32, uri: totp.toString() }
}

export function verifyTotp(secret: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  })
  const delta = totp.validate({ token: token.replace(/\s/g, ''), window: 1 })
  return delta !== null
}

export async function enableTwoFactor(userId: string, secret: string) {
  await db.user.update({
    where: { id: userId },
    data: { totpSecret: secret, is2faEnabled: true },
  })
}

export async function disableTwoFactor(userId: string) {
  await db.user.update({
    where: { id: userId },
    data: { totpSecret: null, is2faEnabled: false },
  })
}
