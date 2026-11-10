/**
 * Next.js instrumentation — runs once when the server process boots.
 * Starts the background job runner (60s tick) in the Node.js runtime only.
 *
 * This is what makes ScheduledJob rows actually execute: trash auto-purge,
 * scheduled emails, webhooks, and queued-email delivery all run from here.
 * (Previously nothing ever read ScheduledJob.nextRunAt.)
 */
export async function register() {
  // Only the Node.js server runtime — never edge, never the browser build.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Guard against double-registration (HMR / multiple boots in dev).
  const g = globalThis as typeof globalThis & { __unstopJobRunner?: NodeJS.Timeout }
  if (g.__unstopJobRunner) return

  // Dynamic import so the edge bundle never pulls Prisma in.
  const { runJobTick } = await import('@/lib/jobs/runner')

  // First tick shortly after boot (let the server finish warming up), then every 60s.
  const timer = setInterval(() => {
    runJobTick().catch((e) => {
      console.warn('[jobs] tick error:', e instanceof Error ? e.message : e)
    })
  }, 60_000)
  // Don't keep the process alive purely for the timer.
  timer.unref?.()
  g.__unstopJobRunner = timer

  setTimeout(() => {
    runJobTick().catch(() => {})
  }, 10_000).unref?.()

  console.log('[jobs] background job runner started (60s tick)')
}
