'use client'

/**
 * CanvasThemeApplier — fetches the org's canvas theme (Platform Settings →
 * Theme) and maps it onto CSS custom properties on <html>. This is the bridge
 * between the saved CanvasTheme DB row and the actual UI: without this
 * component the theme is saved but nothing changes on screen.
 *
 * The Theme tab stores SEMANTIC values (radius: none/small/medium/large/full,
 * density: compact/comfortable/spacious, sidebar: light/dark/colored) — these
 * are mapped to concrete CSS here. Values equal to the app's native brand are
 * CLEARED so the untouched app keeps its native navy identity and light/dark
 * switching works normally; only admin-customized values override.
 *
 * Listens for `unstop:canvas-theme` (dispatched by the Theme tab after each
 * save) and `storage` (cross-tab sync) to apply changes instantly.
 */
import * as React from 'react'

interface CanvasTheme {
  primaryColor: string | null
  accentColor: string | null
  fontFamily: string | null
  borderRadius: string | null
  density: string | null
  sidebarStyle: string | null
}

const DEFAULTS: CanvasTheme = {
  primaryColor: '#223558',
  accentColor: '#3b82f6',
  fontFamily: 'Geist',
  borderRadius: 'medium',
  density: 'comfortable',
  sidebarStyle: 'colored',
}

// Semantic values (what the Theme tab saves) → concrete CSS.
const RADIUS_MAP: Record<string, string> = {
  none: '0rem',
  small: '0.3rem',
  medium: '0.5rem',
  large: '0.75rem',
  full: '9999px',
}
const DENSITY_MAP: Record<string, string> = {
  compact: '0.4rem',
  comfortable: '0.5rem',
  spacious: '0.65rem',
  cozy: '0.65rem',
}
const NATIVE_RADIUS = '0.5rem'
const NATIVE_SPACING = '0.5rem'

/** Luminance-based contrast for --primary-foreground (white on dark, black on light). */
function contrastForeground(hex: string): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return '#ffffff'
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#1f2937' : '#ffffff'
}

function applyTheme(t: CanvasTheme | null) {
  const root = document.documentElement
  if (!t) return

  // primaryColor → --primary + --ring + --primary-foreground (luminance-based)
  if (t.primaryColor && t.primaryColor !== DEFAULTS.primaryColor) {
    root.style.setProperty('--primary', t.primaryColor)
    root.style.setProperty('--ring', t.primaryColor)
    root.style.setProperty('--primary-foreground', contrastForeground(t.primaryColor))
  } else {
    root.style.removeProperty('--primary')
    root.style.removeProperty('--ring')
    root.style.removeProperty('--primary-foreground')
  }

  // accentColor → --accent (color-mix tint of live background so it adapts to dark mode)
  if (t.accentColor && t.accentColor !== DEFAULTS.accentColor) {
    root.style.setProperty('--accent', `color-mix(in srgb, ${t.accentColor} 15%, var(--background))`)
    root.style.setProperty('--accent-foreground', t.accentColor)
  } else {
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-foreground')
  }

  // fontFamily → --font-geist-sans stack
  if (t.fontFamily && t.fontFamily !== DEFAULTS.fontFamily) {
    root.style.setProperty('--font-geist-sans', `'${t.fontFamily}', system-ui, sans-serif`)
  } else {
    root.style.removeProperty('--font-geist-sans')
  }

  // borderRadius → --radius (semantic → CSS; raw CSS values pass through)
  if (t.borderRadius) {
    const r = RADIUS_MAP[t.borderRadius] ?? t.borderRadius
    if (r && r !== NATIVE_RADIUS) root.style.setProperty('--radius', r)
    else root.style.removeProperty('--radius')
  } else {
    root.style.removeProperty('--radius')
  }

  // density → --spacing (compact=tight, comfortable=default, spacious=roomy)
  if (t.density) {
    const s = DENSITY_MAP[t.density] ?? NATIVE_SPACING
    if (s !== NATIVE_SPACING) root.style.setProperty('--spacing', s)
    else root.style.removeProperty('--spacing')
  } else {
    root.style.removeProperty('--spacing')
  }

  // sidebarStyle → --sidebar-* palette
  if (t.sidebarStyle && t.sidebarStyle !== DEFAULTS.sidebarStyle) {
    if (t.sidebarStyle === 'light') {
      root.style.setProperty('--sidebar', '#ffffff')
      root.style.setProperty('--sidebar-foreground', '#1f2937')
    } else if (t.sidebarStyle === 'dark') {
      root.style.setProperty('--sidebar', '#101b2d')
      root.style.setProperty('--sidebar-foreground', '#e2e8f0')
    } else {
      // colored (default navy)
      root.style.setProperty('--sidebar', '#223558')
      root.style.setProperty('--sidebar-foreground', '#e2e8f0')
    }
  } else {
    root.style.removeProperty('--sidebar')
    root.style.removeProperty('--sidebar-foreground')
  }
}

export function CanvasThemeApplier() {
  React.useEffect(() => {
    let cancelled = false
    const load = () =>
      fetch('/api/canvas-theme', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => {
          if (!cancelled && res) {
            // API returns { theme, templates } — extract the theme object.
            const t = res.theme ?? res
            if (t) applyTheme(t)
          }
        })
        .catch(() => {})
    load()

    const onCustomEvent = () => load()
    window.addEventListener('unstop:canvas-theme', onCustomEvent as EventListener)

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'unstop:canvas-theme') load()
    }
    window.addEventListener('storage', onStorage)

    return () => {
      cancelled = true
      window.removeEventListener('unstop:canvas-theme', onCustomEvent as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return null
}
