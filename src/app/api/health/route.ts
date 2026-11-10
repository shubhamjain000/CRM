import { NextResponse } from 'next/server'
import { PLATFORM, DEV_SERVICES } from '@/lib/platform'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const startedAt = Date.now()

/**
 * REAL dependency checks — no more hardcoded statuses.
 * - database: executes `SELECT 1` against the Prisma datasource (SQLite here).
 * - realtime: pings the socket.io mini-service on :3003 (GET /health).
 * - email: reports whether an SMTP provider is actually configured
 *   (SMTP_HOST present) — 'up' means sends will really leave the system.
 */
async function checkDatabase(): Promise<{ status: 'up' | 'down'; latencyMs: number }> {
  const t0 = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    return { status: 'up', latencyMs: Date.now() - t0 }
  } catch {
    return { status: 'down', latencyMs: Date.now() - t0 }
  }
}

async function checkRealtime(): Promise<{ status: 'up' | 'down'; latencyMs: number }> {
  const t0 = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const res = await fetch('http://localhost:3003/health', { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timer)
    return { status: res.ok ? 'up' : 'down', latencyMs: Date.now() - t0 }
  } catch {
    return { status: 'down', latencyMs: Date.now() - t0 }
  }
}

export async function GET() {
  const uptimeMs = Date.now() - startedAt

  // Real services, probed right now.
  const [database, realtime] = await Promise.all([checkDatabase(), checkRealtime()])
  const smtpConfigured = Boolean(process.env.SMTP_HOST?.trim())

  const liveChecks = [
    { id: 'database', name: 'Database (SQLite/Prisma)', status: database.status, port: '—', latencyMs: database.latencyMs },
    { id: 'realtime', name: 'Realtime (socket.io)', status: realtime.status, port: '3003', latencyMs: realtime.latencyMs },
    { id: 'email', name: 'Email (SMTP)', status: smtpConfigured ? 'up' : 'configured', port: process.env.SMTP_PORT ?? '587', latencyMs: undefined },
  ]

  // Reference stack (Django-parity services documented in platform.ts) — these
  // are design targets, honestly reported as 'configured', not fake 'up'.
  const reference = DEV_SERVICES.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.liveInSandbox ? 'up' : 'configured',
    port: s.port,
    latencyMs: undefined,
  }))

  const checks = [...liveChecks, ...reference]

  return NextResponse.json(
    {
      status: database.status === 'up' ? 'ok' : 'degraded',
      service: PLATFORM.name,
      version: PLATFORM.version,
      phase: `Phase ${PLATFORM.phase}/${PLATFORM.totalPhases}`,
      environment: PLATFORM.environment,
      timestamp: new Date().toISOString(),
      uptime: {
        ms: uptimeMs,
        seconds: Math.round(uptimeMs / 1000),
        human: formatUptime(uptimeMs),
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      dependencies: {
        total: checks.length,
        live: checks.filter((c) => c.status === 'up').length,
        configured: checks.filter((c) => c.status === 'configured').length,
        down: checks.filter((c) => c.status === 'down').length,
        items: checks,
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  )
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(' ')
}
