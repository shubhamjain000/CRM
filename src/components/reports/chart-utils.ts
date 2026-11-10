// Shared chart helpers for the reports module (report builder + analytics).
// Framework-free so both recharts views render with the same palette and
// formatting rules.

import type { CSSProperties } from 'react'

/**
 * Categorical palette for charts. Deliberately avoids blue/indigo so charts
 * stand out against the shadcn primary palette.
 */
export const PALETTE = [
  '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6',
  '#f43f5e', '#84cc16', '#f97316', '#06b6d4',
]

const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** Compact number formatting for axis ticks and tooltips (1.2K, 3.4M…). */
export function compact(n: number): string {
  return Number.isFinite(n) ? compactFormat.format(n) : '0'
}

/** Truncate long category labels for axis ticks (default 12 chars). */
export function truncate(label: string, max = 12): string {
  if (!label) return label
  return label.length > max ? `${label.slice(0, max)}…` : label
}

/** Muted axis styling shared by all cartesian charts. */
export const AXIS_TICK = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }
export const AXIS_STROKE = 'hsl(var(--border))'
export const GRID_STROKE = 'hsl(var(--border))'

/** Minimal tooltip chrome matching the card design language. */
export const TOOLTIP_CONTENT_STYLE: CSSProperties = {
  borderRadius: 8,
  border: '1px solid hsl(var(--border))',
  backgroundColor: 'hsl(var(--card))',
  fontSize: 12,
}
