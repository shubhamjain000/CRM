'use client'

import * as React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, MoreHorizontal, Trash2, RefreshCw, Save, ChevronDown, Plus, Upload } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { downloadCsv } from '@/lib/print-table'
import { CrmExportMenu } from './crm-export-menu'
import { FilterRail, FilterDrawer, FilterChips, type ActiveFilter } from './filter-panel'
import type { Column as TableColumn } from './crm-table'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  editable?: boolean
  width?: number
  className?: string
}

// Row-scroll memory keyed by endpoint — lets the list restore the exact scroll
// offset after a detail-view round trip (the list remounts on Back).
const ROW_SCROLL_MEM = new Map<string, number>()

interface Props<T extends { id: string }> {
  title: string
  endpoint: string
  columns: Column<T>[]
  search: string
  onSearchChange: (v: string) => void
  onAdd?: () => void
  onRowClick?: (row: T) => void
  onInlineEdit?: (id: string, field: string, value: string) => Promise<void>
  rowActions?: (row: T) => React.ReactNode
  emptyMessage?: string
  items: T[] | null
  loading: boolean
  total?: number
  onReload: () => void
  savedViews?: { id: string; name: string; isDefault: boolean; isShared?: boolean; config: Record<string, unknown> }[]
  onSaveView?: (name: string, isShared: boolean) => void
  /** Apply a saved view's FULL config (search + filters + sort) — falls back to search-only. */
  onApplyView?: (view: { name: string; config: Record<string, unknown> }) => void
  onDeleteView?: (id: string) => void
  searchInputRef?: React.RefObject<HTMLInputElement | null>
  onImport?: () => void
  exportModule?: string
  exportQuery?: Record<string, string>
  /** Extra filter controls rendered before the search box (e.g. owner filter). */
  filterBar?: React.ReactNode
  filtersActiveCount?: number
  /** Removable chip descriptors for the active filters (shown above the list). */
  activeFilters?: ActiveFilter[]
  onClearFilters?: () => void
  /** Extra bulk operations for the selection bar (receives selected ids + clear). */
  bulkActions?: (ids: string[], clear: () => void) => React.ReactNode
}

export function VirtualList<T extends { id: string }>({
  title, endpoint, columns, search, onSearchChange, onAdd, onRowClick,
  onInlineEdit, rowActions, emptyMessage, items, loading, total, onReload,
  savedViews, onSaveView, onApplyView, onDeleteView, searchInputRef, onImport, exportModule, exportQuery,
  filterBar, filtersActiveCount, activeFilters, onClearFilters, bulkActions,
}: Props<T>) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const [editing, setEditing] = React.useState<{ id: string; field: string; value: string } | null>(null)
  const [saveViewOpen, setSaveViewOpen] = React.useState(false)
  const [viewName, setViewName] = React.useState('')
  const [isShared, setIsShared] = React.useState(false)
  const parentRef = React.useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: items?.length ?? 0,
    getScrollElement: () => parentRef.current,
    // Rows measure themselves (measureElement below) so two-line cells like
    // Lead name + company get real height instead of bleeding into the next row.
    estimateSize: () => 52,
    overscan: 8,
  })

  // Columns flex proportionally to their configured width (grow weight =
  // width) so the table FILLS the viewport on desktop instead of leaving a
  // ragged right edge, and shrinks to an 88px floor on phones. Below the
  // floor the whole table (header included) scrolls horizontally — swiping
  // slides header + rows together and stays aligned.
  const COL_MIN = 88
  const tableMin = 80 + columns.reduce((s, c) => s + COL_MIN, 0)
  const colStyle = (c: Column<T>): React.CSSProperties => ({
    flex: `${c.width ?? 120} 1 0%`,
    minWidth: COL_MIN,
  })

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (!items) return
    setSelected((s) => s.size === items.length ? new Set() : new Set(items.map((i) => i.id)))
  }

  const bulkDelete = async (ids?: string[]) => {
    const target = ids && ids.length > 0 ? ids : [...selected]
    if (target.length === 0) return
    const res = await fetch(`${endpoint}/bulk-delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: target }),
    })
    if (res.ok) {
      toast.success(`Moved ${target.length} to trash`, { action: { label: 'Undo', onClick: () => {
        // Undo: restore each
        target.forEach((id) => fetch(`${endpoint}/restore`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        }))
        setSelected(new Set())
        onReload()
      } } })
      setSelected(new Set())
      onReload()
    }
  }

  // Keep the selection honest: prune ids that are no longer in the list
  // (filters/owner switches/pagination changes), so bulk actions never touch
  // records the user cannot currently see.
  const itemIds = React.useMemo(() => new Set((items ?? []).map((i) => i.id)), [items])
  React.useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const pruned = new Set([...prev].filter((id) => itemIds.has(id)))
      return pruned.size === prev.size ? prev : pruned
    })
  }, [itemIds])

  // Row-scroll restore: jump back to the offset the user left at when the
  // list remounts after a detail-view round trip. The offset is remembered
  // continuously via a scroll listener (a cleanup-time read would run after
  // the node detaches and always report 0).
  React.useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const saved = ROW_SCROLL_MEM.get(endpoint) ?? 0
    if (saved > 0) {
      el.scrollTop = saved
      requestAnimationFrame(() => { el.scrollTop = ROW_SCROLL_MEM.get(endpoint) ?? saved })
    }
    const onScroll = () => { ROW_SCROLL_MEM.set(endpoint, el.scrollTop) }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [endpoint])

  // Keyboard navigation: j/k to move, e to edit
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (!items || items.length === 0) return
      if (e.key === 'j') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, items.length - 1)) }
      if (e.key === 'k') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)) }
      if (e.key === 'e' && activeIndex >= 0) {
        e.preventDefault()
        const row = items[activeIndex]
        if (row) onRowClick?.(row) // activeIndex can outlive a shrunken list
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [items, activeIndex, onRowClick])

  const commitEdit = async () => {
    if (!editing || !onInlineEdit) return
    try {
      await onInlineEdit(editing.id, editing.field, editing.value)
      toast.success('Updated')
    } catch {
      toast.error('Update failed')
    }
    setEditing(null)
    onReload()
  }

  const totalHeight = rowVirtualizer.getTotalSize()

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Filter rail (lg+) sits LEFT of the list and never reflows when the
          results update; below lg the FilterDrawer trigger replaces it. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start">
      {filterBar && (
        <FilterRail
          activeCount={filtersActiveCount ?? 0}
          activeFilters={activeFilters}
          onClearAll={onClearFilters}
        >
          {filterBar}
        </FilterRail>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {title}
            {(filtersActiveCount ?? 0) > 0 && (
              <button
                type="button"
                onClick={onClearFilters}
                title="Clear all filters"
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition hover:bg-primary/15"
              >
                {filtersActiveCount} filter{(filtersActiveCount ?? 0) === 1 ? '' : 's'} · clear
              </button>
            )}
          </h1>
          {total !== undefined && <p className="text-sm text-muted-foreground">{total} records</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Saved filters */}
          {savedViews && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Save className="mr-1.5 size-3.5" /> Filters
                  <Badge variant="secondary" className="ml-1 px-1.5 font-mono text-[10px]">{savedViews.length}/10</Badge>
                  <ChevronDown className="ml-1 size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="text-xs font-semibold uppercase text-muted-foreground" disabled>
                  My Views
                </DropdownMenuItem>
                {savedViews.length === 0 && (
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    No saved filters yet — set filters, then Save filter.
                  </DropdownMenuItem>
                )}
                {savedViews.filter((v) => !v.isShared && !v.config?.isShared).map((v) => (
                  <DropdownMenuItem key={v.id} onClick={() => onApplyView ? onApplyView(v) : onSearchChange(String(v.config?.search ?? ''))}>
                    <span className="min-w-0 flex-1 truncate">{v.name}</span>
                    {onDeleteView && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete filter ${v.name}`}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteView(v.id) }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </DropdownMenuItem>
                ))}
                {savedViews.some((v) => v.isShared || v.config?.isShared) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-xs font-semibold uppercase text-muted-foreground" disabled>
                      Shared
                    </DropdownMenuItem>
                    {savedViews.filter((v) => v.isShared || v.config?.isShared).map((v) => (
                      <DropdownMenuItem key={v.id} onClick={() => onApplyView ? onApplyView(v) : onSearchChange(String(v.config?.search ?? ''))}>
                        <span className="min-w-0 flex-1 truncate">{v.name}</span>
                        {onDeleteView && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete filter ${v.name}`}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteView(v.id) }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {onSaveView && (
            <Button variant="outline" size="sm" onClick={() => setSaveViewOpen(true)}>
              <Save className="mr-1.5 size-3.5" /> Save view
            </Button>
          )}
          {filterBar && (
            <FilterDrawer
              activeCount={filtersActiveCount ?? 0}
              activeFilters={activeFilters}
              onClearAll={onClearFilters}
            >
              {filterBar}
            </FilterDrawer>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search records…"
              className="h-9 w-full pl-8 sm:w-72"
            />
          </div>
          <Button variant="outline" size="icon" className="size-9" onClick={onReload} aria-label="Refresh" title="Refresh">
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {onImport && (
            <Button variant="outline" size="sm" onClick={onImport} title="Import from CSV, Excel, Word, PDF or JSON">
              <Upload className="mr-1.5 size-3.5" /> Import
            </Button>
          )}
          {exportModule && (
            <CrmExportMenu
              title={title}
              exportModule={exportModule}
              total={total}
              items={items}
              columns={columns}
              search={search}
              exportQuery={exportQuery}
            />
          )}
          {onAdd && <Button onClick={onAdd}><Plus className="mr-1.5 size-4" /> Add</Button>}
        </div>
      </div>

      {/* Active filter chips — removable, above the results on every size */}
      <FilterChips filters={activeFilters} onClearAll={onClearFilters} />

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-background/95 px-4 py-2.5 text-sm shadow-lg backdrop-blur">
          <span className="font-medium">{selected.size} selected</span>
          {bulkActions && bulkActions([...selected], () => setSelected(new Set()))}
          <Button variant="outline" size="sm" onClick={() => bulkDelete()} className="text-destructive">
            <Trash2 className="mr-1.5 size-3.5" /> Move to trash
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            if (!items) return
            const rows = items.filter((i) => selected.has(i.id))
            if (rows.length === 0) return
            downloadCsv(
              `${title.toLowerCase()}-selected-${new Date().toISOString().slice(0, 10)}.csv`,
              columns.map((c) => c.header),
              rows.map((r) => columns.map((c) => {
                const v = (r as Record<string, unknown>)[c.key]
                return v === null || v === undefined ? '' : String(v)
              })),
            )
            toast.success(`Exported ${rows.length} selected records`)
          }}>
            <Upload className="mr-1.5 size-3.5 rotate-180" /> Export
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {/* Virtual scroll table */}
      <Card className="flex-1 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : !items || items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted"><Search className="size-5 text-muted-foreground" /></div>
              <p className="text-sm text-muted-foreground">{emptyMessage ?? 'No records found'}</p>
            </div>
          ) : (
            <div className="flex flex-col" style={{ height: 'calc(100vh - 280px)', minHeight: '300px' }}>
              {/* Horizontal scroll context — header AND rows share it, so on
                  narrow screens swiping slides them together and aligned. */}
              <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
                <div className="flex min-h-0 flex-1 flex-col" style={{ width: `max(100%, ${tableMin}px)` }}>
                  {/* Header row */}
                  <div className="flex shrink-0 border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <div className="w-10 shrink-0 px-3 py-2.5">
                      <Checkbox checked={selected.size === items.length && items.length > 0} onCheckedChange={toggleAll} />
                    </div>
                    {columns.map((c) => (
                      <div key={c.key} className={`px-4 py-2.5 font-medium ${c.className ?? ''}`} style={colStyle(c)}>
                        {c.header}
                      </div>
                    ))}
                    {(rowActions || onRowClick) && <div className="w-10 shrink-0" />}
                  </div>
                  {/* Virtual rows */}
                  <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
                    <div style={{ height: `${totalHeight}px`, position: 'relative', width: '100%' }}>
                      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const row = items![virtualRow.index]
                        const isActive = virtualRow.index === activeIndex
                        const isSelected = selected.has(row.id)
                        return (
                          <div
                            key={row.id}
                            data-index={virtualRow.index}
                            ref={rowVirtualizer.measureElement}
                            className={`absolute left-0 top-0 flex w-full overflow-hidden border-b transition-colors ${
                              isActive ? 'bg-primary/10' : isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'
                            }`}
                            style={{ transform: `translateY(${virtualRow.start}px)` }}
                            onClick={() => { setActiveIndex(virtualRow.index); onRowClick?.(row) }}
                          >
                            <ContextMenu>
                              <ContextMenuTrigger asChild>
                                <div className="flex w-full">
                                  <div className="w-10 shrink-0 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                                    <Checkbox checked={isSelected} onCheckedChange={() => toggle(row.id)} />
                                  </div>
                                  {columns.map((c) => (
                                    <div key={c.key} className={`min-w-0 px-4 py-2.5 ${c.className ?? ''}`} style={colStyle(c)}>
                                  {editing?.id === row.id && editing?.field === c.key && c.editable ? (
                                    <input
                                      autoFocus
                                      className="w-full rounded border bg-background px-1 py-0.5 text-sm"
                                      defaultValue={String((row as Record<string, unknown>)[c.key] ?? '')}
                                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                      onBlur={commitEdit}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitEdit()
                                        if (e.key === 'Escape') setEditing(null)
                                      }}
                                    />
                                  ) : (
                                    <div
                                      className="cursor-text truncate text-sm"
                                      onClick={(e) => {
                                        if (c.editable && onInlineEdit) {
                                          e.stopPropagation()
                                          setEditing({ id: row.id, field: c.key, value: String((row as Record<string, unknown>)[c.key] ?? '') })
                                        }
                                      }}
                                    >
                                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                                    </div>
                                  )}
                                </div>
                              ))}
                              {rowActions && (
                                <div className="w-10 shrink-0 px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">{rowActions(row)}</DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              )}
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => onRowClick?.(row)}>Open</ContextMenuItem>
                            <ContextMenuItem onClick={() => { if (onInlineEdit) setEditing({ id: row.id, field: columns[0].key, value: '' }) }}>Edit</ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem className="text-destructive" onClick={() => { toggle(row.id); void bulkDelete([row.id]) }}>
                              Move to trash
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      </div>
                    )
                  })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save view dialog */}
      <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
            <DialogDescription>Save the current search + filters for quick access.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>View name</Label>
              <Input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="My open leads" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isShared} onCheckedChange={(v) => setIsShared(v === true)} />
              Share with team
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveViewOpen(false)}>Cancel</Button>
            <Button onClick={() => { onSaveView?.(viewName, isShared); setSaveViewOpen(false); setViewName('') }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
      </div>
    </div>
  )
}
