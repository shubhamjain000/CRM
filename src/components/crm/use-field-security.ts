'use client'

/**
 * Client-side mirror of the server's field-level security (Tier 3).
 *
 * Fetches the CALLING user's effective restrictions once per session via
 * GET /api/security/field-security?mine=1 (module → { hidden, readOnly }) and
 * shares them across every consumer through a module-level cache.
 *
 * Design rules:
 *  - Never blocks the UI: until the fetch resolves (or if it fails) the hook
 *    reports NO restrictions, so forms/lists/detail render exactly as before.
 *  - A failed fetch degrades to "no restrictions" (same as server behavior for
 *    admins / unconfigured orgs); `refresh()` retries on demand.
 *  - Server-side enforcement at the API boundary stays the source of truth —
 *    this hook only prevents users from typing into fields the server would
 *    strip anyway and hides fields they could never see.
 */

import * as React from 'react'

export interface MineRules {
  [model: string]: { hidden: string[]; readOnly: string[] }
}

/** Form/detail/list keys → field-security catalog keys (emails/phones are JSON arrays). */
export const FIELD_SECURITY_KEY_ALIASES: Record<string, string> = {
  email: 'emails',
  phone: 'phones',
  owner: 'ownerId',
  account: 'accountId',
  stage: 'stageId',
}

/** Map a UI field key onto its field-security catalog key (identity when none). */
export function securityKey(key: string): string {
  return FIELD_SECURITY_KEY_ALIASES[key] ?? key
}

const EMPTY_RULES: MineRules = {
  lead: { hidden: [], readOnly: [] },
  contact: { hidden: [], readOnly: [] },
  account: { hidden: [], readOnly: [] },
  deal: { hidden: [], readOnly: [] },
}

// --- session-wide shared state -------------------------------------------------

let cache: MineRules | null = null
let inflight: Promise<MineRules> | null = null
const listeners = new Set<() => void>()
/** hidden-Set memo per model — cleared whenever the rules cache is replaced. */
const hiddenSetCache = new Map<string, Set<string>>()

function notifyListeners(): void {
  for (const fn of listeners) fn()
}

async function fetchMine(): Promise<MineRules> {
  const res = await fetch('/api/security/field-security?mine=1', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Field security unavailable (${res.status})`)
  const data = (await res.json()) as { mine?: MineRules }
  return data.mine && typeof data.mine === 'object' ? data.mine : EMPTY_RULES
}

/** Load (or reuse) the session's rules. `force` re-fetches (refresh()). */
function loadMine(force = false): Promise<MineRules> {
  if (cache && !force) return Promise.resolve(cache)
  if (!inflight) {
    inflight = fetchMine()
      .then((mine) => {
        cache = mine
        hiddenSetCache.clear()
        notifyListeners()
        return mine
      })
      .catch(() => {
        // Graceful degradation: treat as no restrictions rather than blocking UI.
        // Keep any previously-known rules on a failed refresh.
        if (!cache) cache = EMPTY_RULES
        hiddenSetCache.clear()
        notifyListeners()
        return cache
      })
      .finally(() => { inflight = null })
  }
  return inflight
}

export interface FieldSecurityApi {
  /** True once the session fetch settled (success OR graceful failure). */
  ready: boolean
  /** Set of catalog keys hidden for the caller's role in `model` (empty when none). */
  hiddenFor: (model: string) => Set<string>
  /** Whether `key` is read-only for the caller's role in `model`. */
  isReadOnly: (model: string, key: string) => boolean
  /** Force a re-fetch (e.g. after the admin changes rules elsewhere). */
  refresh: () => void
}

export function useFieldSecurity(): FieldSecurityApi {
  const [ready, setReady] = React.useState(() => cache !== null)
  const [, setVersion] = React.useState(0)

  React.useEffect(() => {
    let mounted = true
    const onChange = () => {
      if (!mounted) return
      setReady(true)
      setVersion((v) => v + 1) // re-render consumers with the fresh rules
    }
    listeners.add(onChange)
    void loadMine()
    return () => {
      mounted = false
      listeners.delete(onChange)
    }
  }, [])

  const hiddenFor = React.useCallback((model: string): Set<string> => {
    const hit = hiddenSetCache.get(model)
    if (hit) return hit
    const set = new Set(cache?.[model]?.hidden ?? [])
    hiddenSetCache.set(model, set)
    return set
  }, [])

  const isReadOnly = React.useCallback(
    (model: string, key: string): boolean => (cache?.[model]?.readOnly ?? []).includes(key),
    [],
  )

  const refresh = React.useCallback(() => {
    void loadMine(true)
  }, [])

  return React.useMemo(
    () => ({ ready, hiddenFor, isReadOnly, refresh }),
    [ready, hiddenFor, isReadOnly, refresh],
  )
}
