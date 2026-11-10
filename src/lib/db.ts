import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // `query` logging was removed: with several UI pollers (WhatsApp status,
    // presence, notifications) hammering the API, per-query logging generated
    // heavy I/O + allocation churn that ballooned the dev server past the
    // sandbox RAM limit and wedged the whole app (users saw WhatsApp as
    // "service unreachable"). Errors and warnings are still surfaced.
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db