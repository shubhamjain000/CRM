/**
 * JSON.parse that never throws.
 *
 * Many rows carry JSON-encoded strings from the DB (hashtags, tags,
 * toAddresses, workflow action logs, custom-module record data, …).
 * A malformed or unexpectedly-shaped value must degrade to `fallback`
 * instead of crashing the render tree.
 */
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed === null || parsed === undefined ? fallback : parsed) as T
  } catch {
    return fallback
  }
}
