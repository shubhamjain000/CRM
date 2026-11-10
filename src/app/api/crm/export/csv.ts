export function safeJsonParseList(v: unknown): string[] {
  if (typeof v !== 'string') return Array.isArray(v) ? v.map(String) : []
  try {
    const p = JSON.parse(v)
    return Array.isArray(p) ? p.map(String) : []
  } catch {
    return []
  }
}
