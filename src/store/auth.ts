'use client'

import { create } from 'zustand'

export interface SessionOrg {
  id: string
  name: string
  slug: string
  subdomain: string
  role: string
  isCurrent: boolean
  membersCount: number
}

export interface SessionPasskey {
  id: string
  name: string
  createdAt: string
}

export interface SessionUser {
  id: string
  email: string
  name: string
  is2faEnabled: boolean
  hasPasskey: boolean
}

/** sessionStorage key for the bearer fallback. sessionStorage (not memory)
 *  so an embedded-preview session SURVIVES a page refresh — the in-memory
 *  store was wiped on reload, which dropped the only working credential
 *  when third-party cookies are blocked and bounced the user back to the
 *  landing page (the recurring "sidebar disappears on refresh" issue). */
const BEARER_KEY = 'fn_bearer'

function readStoredBearer(): string | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage.getItem(BEARER_KEY)
  } catch {
    return null
  }
}

function writeStoredBearer(t: string | null) {
  try {
    if (typeof window === 'undefined') return
    if (t) window.sessionStorage.setItem(BEARER_KEY, t)
    else window.sessionStorage.removeItem(BEARER_KEY)
  } catch {
    // storage unavailable (private mode) — memory-only fallback still works
  }
}

interface AuthState {
  user: SessionUser | null
  organizations: SessionOrg[]
  currentOrgId: string | null
  permissions: string[]
  passkeys: SessionPasskey[]
  loading: boolean
  error: string | null
  /** Bearer token — Authorization header fallback when cookies are blocked
   *  (e.g. embedded previews). Persisted in sessionStorage so it survives a
   *  page refresh; cleared on logout. */
  bearerToken: string | null

  fetchMe: (token?: string) => Promise<boolean>
  setBearerToken: (t: string | null) => void
  logout: () => Promise<void>
  switchOrg: (orgId: string) => Promise<void>
  setError: (e: string | null) => void
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  organizations: [],
  currentOrgId: null,
  permissions: [],
  passkeys: [],
  loading: true,
  error: null,
  bearerToken: readStoredBearer(),

  setBearerToken: (t) => {
    writeStoredBearer(t)
    set({ bearerToken: t })
  },

  fetchMe: async (token?: string) => {
    set({ loading: true, error: null })
    // A genuine 401 (logged out / expired session) resolves immediately —
    // only NETWORK failures (fetch throws) are retried with backoff. When the
    // dev server recycles (memory guard) or the preview gateway hiccups, the
    // HMR reconnect triggers a page reload whose /api/auth/me lands in the
    // boot window. Without retries that failure permanently dumped the user
    // on the landing page ("login keeps logging me out"); with retries the
    // session self-heals as soon as the server answers again.
    const ATTEMPTS = 5
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const bearer = token ?? get().bearerToken
        const headers: Record<string, string> = {}
        if (bearer) headers['Authorization'] = `Bearer ${bearer}`
        const res = await fetch('/api/auth/me', { cache: 'no-store', headers })
        if (!res.ok) {
          set({ user: null, loading: false })
          return false
        }
        const data = await res.json()
        set({
          user: data.user,
          organizations: data.organizations ?? [],
          currentOrgId: data.currentOrgId,
          permissions: data.permissions ?? [],
          passkeys: data.passkeys ?? [],
          loading: false,
        })
        return true
      } catch {
        if (attempt < ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
          continue
        }
        set({ user: null, loading: false })
        return false
      }
    }
    return false
  },

  logout: async () => {
    const bearer = get().bearerToken
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    })
    writeStoredBearer(null)
    set({ user: null, organizations: [], currentOrgId: null, permissions: [], passkeys: [], bearerToken: null })
  },

  switchOrg: async (orgId: string) => {
    await fetch('/api/organizations/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: orgId }),
    })
    await get().fetchMe()
  },

  setError: (e) => set({ error: e }),
}))
