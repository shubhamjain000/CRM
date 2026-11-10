'use client'

import * as React from 'react'
import { Pencil } from 'lucide-react'
import { safeJsonParse } from '@/components/safe-json'

/**
 * Zoho-style "Listing history" table on the contact detail view — the exact
 * same organized column bar as the Listings board, with every option in its
 * own fixed-width column, single-line headers, vertical dividers and
 * horizontal scrolling (no wrapping, no overlap):
 *   # · Listing Title · Date Approved · Applications · Listing URL ·
 *   Listing Type · Visibility · Hired Count · Hiring Status · Created Time ·
 *   Relevant Applications (34% match & above) · Category
 * Sections the sales agent owns (Visibility, Hired Count, Hiring Status…)
 * stay blank ("—") until filled via the Listings board Edit dialog.
 */

export interface ListingHistoryRow {
  id: string
  url?: string | null
  title?: string | null
  subtype?: string | null
  category?: string | null
  recruiterTag?: string | null
  premiumStatus?: string | null
  visibility?: string | null
  hiringStatus?: string | null
  totalApplications?: number | null
  relevantApplications?: number | null
  hiredCount?: number | null
  dateApproved?: string | null
  firstImportedAt?: string
  lastImportedAt?: string
  createdAt?: string
  source?: string
}

const dash = <span className="text-muted-foreground">—</span>
const fmtDate = (v: string | null | undefined) =>
  v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toLocaleDateString() : null
const fmtDateTime = (v: string | null | undefined) =>
  v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toLocaleString() : null
const fmtNum = (v: number | null | undefined) =>
  v === null || v === undefined ? null : v.toLocaleString()

/** Listing Type pill — Jobs = violet-tinted, Internships = teal-tinted. */
function TypePill({ type }: { type: string | null | undefined }) {
  if (!type) return dash
  const cls = type.toLowerCase() === 'internships'
    ? 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
    : 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{type}</span>
}

/** Visibility pill — Public = emerald, Private = muted. */
function VisibilityPill({ visibility }: { visibility: string | null | undefined }) {
  if (!visibility) return dash
  const isPublic = visibility.toLowerCase() === 'public'
  const cls = isPublic
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : 'bg-muted text-muted-foreground'
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{visibility}</span>
}

/** Hiring Status pill — Open = emerald, In Review = amber, Filled = teal, Closed = muted. */
function HiringStatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return dash
  const lower = status.toLowerCase()
  const cls = lower === 'open'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : lower === 'in review'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
      : lower === 'filled'
        ? 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
        : 'bg-muted text-muted-foreground'
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>
}

/** Truncated, fully clickable listing URL (display truncates, href stays complete). */
function ListingLink({ url }: { url: string | null | undefined }) {
  if (!url) return dash
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className="inline-block max-w-full truncate align-bottom text-primary underline underline-offset-2 hover:opacity-80"
    >
      {url}
    </a>
  )
}

/** Column widths mirrored from the Listings board (table-fixed + min-width). */
const HISTORY_COLS = [
  { key: 'idx', header: '#', width: 'w-10' },
  { key: 'title', header: 'Listing Title', width: 'w-60' },
  { key: 'dateApproved', header: 'Date Approved', width: 'w-32' },
  { key: 'totalApplications', header: 'Applications', width: 'w-28' },
  { key: 'url', header: 'Listing URL', width: 'w-40' },
  { key: 'subtype', header: 'Listing Type', width: 'w-32' },
  { key: 'visibility', header: 'Visibility', width: 'w-28' },
  { key: 'hiredCount', header: 'Hired Count', width: 'w-28' },
  { key: 'hiringStatus', header: 'Hiring Status', width: 'w-36' },
  { key: 'createdAt', header: 'Created Time', width: 'w-44' },
  { key: 'relevantApplications', header: 'Relevant Applications (34% match & above)', width: 'w-80' },
  { key: 'category', header: 'Category', width: 'w-64' },
] as const

export function ListingHistoryTable({ listings }: { listings: ListingHistoryRow[] }) {
  if (!listings || listings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No listings imported yet — import a CSV on the Listings board to build this recruiter&apos;s history.
      </p>
    )
  }
  return (
    <div className="overflow-x-auto overscroll-contain" data-testid="listing-history-table">
      <table className="w-full table-fixed min-w-[1930px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            {HISTORY_COLS.map((c) => (
              <th
                key={c.key}
                className={`whitespace-nowrap border-b border-border border-l border-border/60 px-1.5 py-2.5 font-medium first:border-l-0 ${c.width}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {listings.map((l, i) => {
            const lcats = safeJsonParse<string[]>(l.category ?? '', [])
            const created = fmtDateTime(l.createdAt) ?? fmtDateTime(l.firstImportedAt)
            return (
              <tr key={l.id} className="align-top transition-colors hover:bg-muted/30">
                <td className="border-b border-border/40 border-l border-border/60 px-1.5 py-2.5 tabular-nums text-muted-foreground first:border-l-0">{i + 1}</td>
                <td className="border-b border-border/40 border-l border-border/60 px-1.5 py-2.5">
                  {l.title
                    ? <span className="line-clamp-2 font-medium" title={l.title}>{l.title}</span>
                    : <span className="inline-flex items-center gap-1.5 text-xs italic text-muted-foreground">To be filled <Pencil className="size-3" aria-hidden="true" /></span>}
                </td>
                <td className="whitespace-nowrap border-b border-border/40 border-l border-border/60 px-1.5 py-2.5">{fmtDate(l.dateApproved) ?? fmtDate(l.firstImportedAt) ?? dash}</td>
                <td className="border-b border-border/40 border-l border-border/60 px-1.5 py-2.5 text-right tabular-nums">{fmtNum(l.totalApplications) ?? dash}</td>
                <td className="border-b border-border/40 border-l border-border/60 px-1.5 py-2.5"><ListingLink url={l.url} /></td>
                <td className="border-b border-border/40 border-l border-border/60 px-1.5 py-2.5"><TypePill type={l.subtype} /></td>
                <td className="border-b border-border/40 border-l border-border/60 px-1.5 py-2.5"><VisibilityPill visibility={l.visibility} /></td>
                <td className="border-b border-border/40 border-l border-border/60 px-1.5 py-2.5 text-right tabular-nums">{fmtNum(l.hiredCount) ?? dash}</td>
                <td className="border-b border-border/40 border-l border-border/60 px-1.5 py-2.5"><HiringStatusPill status={l.hiringStatus} /></td>
                <td className="whitespace-nowrap border-b border-border/40 border-l border-border/60 px-1.5 py-2.5">{created ?? dash}</td>
                <td className="border-b border-border/40 border-l border-border/60 px-1.5 py-2.5 text-right tabular-nums">{fmtNum(l.relevantApplications) ?? dash}</td>
                <td className="border-b border-border/40 border-l border-border/60 px-1.5 py-2.5">
                  {lcats.length > 0
                    ? <span className="line-clamp-2 text-xs text-muted-foreground" title={lcats.join(', ')}>{lcats.join(', ')}</span>
                    : dash}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
