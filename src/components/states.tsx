'use client'

import * as React from 'react'
import { AlertCircle, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Shared empty / error / loading states so every view settles its data the
 * same way. Tailwind + existing primitives only — no new dependencies.
 */

/** Centered, muted, dashed-border card for the "nothing here yet" case. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      {Icon && (
        <div className="mb-1.5 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/** Destructive-tinted failure card with an optional retry action. */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  className,
}: {
  title?: string
  description?: React.ReactNode
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="mb-1.5 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-5" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-destructive">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          Try again
        </Button>
      )}
    </div>
  )
}

/* Deterministic per-column widths (first cell reads as the row checkbox,
   the rest alternate fixed/flexible so rows look like real table content). */
const SKELETON_COL_WIDTHS = [
  'w-9 shrink-0',
  'flex-1',
  'w-28 shrink-0',
  'flex-1',
  'w-20 shrink-0',
  'flex-1',
] as const

/** Placeholder rows for data tables while records are loading. */
export function TableSkeleton({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading records"
      className={cn('space-y-2.5 p-4', className)}
    >
      {Array.from({ length: Math.max(rows, 0) }).map((_, r) => (
        <div key={r} className="flex items-center gap-3" aria-hidden="true">
          {Array.from({ length: Math.max(cols, 1) }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn('h-10 rounded-md', SKELETON_COL_WIDTHS[c % SKELETON_COL_WIDTHS.length])}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
