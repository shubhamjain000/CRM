import { db } from '@/lib/db'
import { createHash, randomBytes } from 'crypto'

const MAGIC_LINK_TTL_MIN = 15

export async function createMagicLink(email: string): Promise<string> {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } })
  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)

  await db.magicLink.create({
    data: {
      email: email.toLowerCase(),
      tokenHash,
      userId: user?.id,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MIN * 60 * 1000),
    },
  })

  return token
}

export async function verifyMagicLink(token: string): Promise<string | null> {
  const tokenHash = hashToken(token)
  const link = await db.magicLink.findUnique({ where: { tokenHash } })
  if (!link) return null
  if (link.usedAt) return null
  if (link.expiresAt < new Date()) return null

  await db.magicLink.update({
    where: { id: link.id },
    data: { usedAt: new Date() },
  })

  // If user didn't exist yet, create one (magic-link signup)
  let userId = link.userId
  if (!userId) {
    const user = await db.user.create({
      data: { email: link.email, name: link.email.split('@')[0] },
    })
    userId = user.id
  }
  return userId
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
