'use client'

import * as React from 'react'

/**
 * Registers the PWA service worker after load. Rendered once from the root
 * layout; no-ops on unsupported browsers. Keeps installed iOS/Android home
 * screen apps working offline (network-first, API never cached).
 */
export function PWARegistrar() {
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* registration blocked (e.g. inside sandboxed preview) — the app still works */
      })
    }
    if (document.readyState === 'complete') {
      register()
      return
    }
    window.addEventListener('load', register)
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
