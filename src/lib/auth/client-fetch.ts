'use client'

/**
 * Client-side fetch interceptor.
 *
 * When the session cookie is blocked (e.g. embedded previews with third-party
 * cookie restrictions), we fall back to an in-memory bearer token stored in
 * the auth zustand store. This module patches `window.fetch` so every
 * same-origin /api/ request automatically includes
 * `Authorization: Bearer <token>` when a token is present. This keeps all API
 * routes working in cookieless contexts without touching each call site.
 */
import { useEffect } from 'react'
import { useAuth } from '@/store/auth'

export function AuthFetchInterceptor() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const originalFetch = window.fetch
    window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const isSameOriginApi =
          url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`)
        const bearer = useAuth.getState().bearerToken
        if (isSameOriginApi && bearer) {
          const headers = new Headers(init?.headers)
          // Don't overwrite an explicit Authorization header
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${bearer}`)
          }
          init = { ...init, headers }
        }
      } catch {
        // ignore — fall through to original fetch
      }
      return originalFetch(input, init)
    }
    return () => {
      window.fetch = originalFetch
    }
  }, [])
  return null
}
