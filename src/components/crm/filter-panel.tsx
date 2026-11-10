'use client'

import * as React from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Shared Zoho-style filter panel — ONE implementation used by every CRM list
 * (VirtualList and CrmTable), so the behaviour is identical app-wide:
 *
 * - Desktop (lg+): a vertical filter rail pinned to the left of the list.
 *   Sticky, always visible, and fully detached from the results column, so
 *   the panel never shifts or reflows when the list updates.
 * - Mobile / tablet (<lg): collapsed by default behind a "Filters" button
 *   that carries the active-filter count badge. Opening it uses the shared
 *   Sheet — which is a bottom sheet on phones and a right drawer on tablets.
 * - Active filters render as removable chips above the results on every
 *   breakpoint, with a "Clear all" button that is always visible while any
 *   filter is active.
 *
 * The component is purely presentational: the filter controls themselves are
 * passed through as `children` and their state stays owned by the views.
 */

/** One removable active-filter chip descriptor. */
export interface ActiveFilter {
  key: string
  label: string
  onRemove: () => void
}

interface PanelProps {
  activeCount: number
  activeFilters?: ActiveFilter[]
  onClearAll?: () => void
  children: React.ReactNode
}

/**
 * Stacks toolbar-oriented filter controls vertically and stretches selects
 * and buttons to the full rail width (popover/dialog content is portaled and
 * therefore unaffected).
 */
export const FILTER_STACK_CLASS =
  'flex flex-col items-stretch gap-2 [&>div]:w-full [&_[data-slot=select-trigger]]:w-full [&_[data-slot=button]]:w-full [&_[data-slot=button]]:justify-start'

/** Panel body shared by the rail and the drawer (title/count live in headers). */
function PanelControls({ activeCount, onClearAll, children }: PanelProps) {
  return (
    <>
      {activeCount > 0 && onClearAll && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 justify-start text-xs text-destructive hover:text-destructive"
          onClick={onClearAll}
        >
          <X className="mr-1 size-3.5" /> Clear all filters ({activeCount})
        </Button>
      )}
      <div className={FILTER_STACK_CLASS}>{children}</div>
    </>
  )
}

/** Removable active-filter chips shown above the results list. */
export function FilterChips({
  filters,
  onClearAll,
  className,
}: {
  filters?: ActiveFilter[]
  onClearAll?: () => void
  className?: string
}) {
  if (!filters || filters.length === 0) return null
  return (
    <div
      role="list"
      aria-label="Active filters"
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      {filters.map((f) => (
        <span
          key={f.key}
          role="listitem"
          className="inline-flex max-w-full items-center gap-0.5 rounded-full border bg-primary/5 py-1 pl-2.5 pr-1 text-xs font-medium text-foreground shadow-soft-sm transition-colors"
        >
          <span className="max-w-[14rem] truncate">{f.label}</span>
          <button
            type="button"
            onClick={f.onRemove}
            aria-label={`Remove filter ${f.label}`}
            className="ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {onClearAll && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
          onClick={onClearAll}
        >
          Clear all
        </Button>
      )}
    </div>
  )
}

/** Desktop (lg+) vertical filter rail, sticky at the left of the list. */
export function FilterRail({ activeCount, activeFilters, onClearAll, children }: PanelProps) {
  return (
    <aside
      aria-label="Filters"
      className="hidden w-60 shrink-0 self-start lg:sticky lg:top-0 lg:block"
    >
      <div className="flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-xl border bg-card shadow-soft-sm">
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">Filters</span>
          {activeCount > 0 && (
            <Badge className="ml-auto h-5 min-w-5 justify-center rounded-full px-1.5 font-mono text-[10px]">
              {activeCount}
            </Badge>
          )}
        </div>
        <div className="main-scroll flex flex-1 flex-col gap-3 overflow-y-auto p-3">
          <PanelControls activeCount={activeCount} activeFilters={activeFilters} onClearAll={onClearAll}>
            {children}
          </PanelControls>
        </div>
      </div>
    </aside>
  )
}

/** Mobile/tablet (<lg) collapsed filters: trigger button + shared Sheet. */
export function FilterDrawer({ activeCount, activeFilters, onClearAll, children }: PanelProps) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-9 lg:hidden"
        onClick={() => setOpen(true)}
        aria-label={`Open filters${activeCount > 0 ? ` (${activeCount} active)` : ''}`}
        aria-haspopup="dialog"
      >
        <SlidersHorizontal className="size-4" />
        Filters
        {activeCount > 0 && (
          <Badge className="ml-1 h-4.5 min-w-4.5 justify-center rounded-full px-1.5 font-mono text-[10px]">
            {activeCount}
          </Badge>
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xs">
          <SheetHeader className="border-b px-4 pb-3 pt-5">
            <SheetTitle className="flex items-center gap-2 text-base">
              <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />
              Filters
              {activeCount > 0 && (
                <Badge className="h-5 min-w-5 justify-center rounded-full px-1.5 font-mono text-[10px]">
                  {activeCount}
                </Badge>
              )}
            </SheetTitle>
            <SheetDescription className="text-xs">Refine the list below.</SheetDescription>
          </SheetHeader>
          <div className="main-scroll flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            <PanelControls activeCount={activeCount} activeFilters={activeFilters} onClearAll={onClearAll}>
              {children}
            </PanelControls>
          </div>
          <SheetFooter className="border-t px-4 py-3">
            <Button className="w-full" onClick={() => setOpen(false)}>
              Show results
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
