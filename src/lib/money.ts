// Indian currency formatting helpers (₹ with en-IN digit grouping: 12,34,567).
// Shared so every module (inventory CPQ, deals, campaigns, dashboards, AI
// context) renders money the same professional way.

const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** ₹1,23,456.78 — Indian grouping, two decimals (line items, quotes, invoices). */
export function fmtINR(n: number): string {
  return `₹${inr2.format(Number.isFinite(n) ? n : 0)}`
}

/** ₹1,23,457 — whole-rupee amount (budgets, KPI tiles, summary rows). */
export function fmtINR0(n: number): string {
  return `₹${inr0.format(Number.isFinite(n) ? n : 0)}`
}

function trim1(v: number): string {
  return (Math.round(v * 10) / 10).toString()
}

/**
 * Compact Indian notation for tight spots (kanban cards, KPI tiles):
 * ₹2.4Cr (crore) · ₹8.5L (lakh) · ₹42.3K · ₹9,999 below a thousand.
 * Implemented manually so every runtime renders identical lakh/crore output.
 */
export function fmtINRCompact(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  if (Math.abs(v) >= 1e7) return `₹${trim1(v / 1e7)}Cr`
  if (Math.abs(v) >= 1e5) return `₹${trim1(v / 1e5)}L`
  if (Math.abs(v) >= 1e3) return `₹${trim1(v / 1e3)}K`
  return fmtINR0(v)
}

/**
 * Same compact scale WITHOUT the ₹ symbol — for spots that already render the
 * IndianRupee icon next to the value (icon + "₹73.4L" would double the symbol).
 */
export function fmtCompactBare(n: number): string {
  return fmtINRCompact(n).replace(/^₹/, '')
}
