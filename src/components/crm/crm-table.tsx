'use client'

import * as React from 'react'
import {
  Search, Plus, MoreHorizontal, Trash2, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown,
  Upload, Download, Columns3, CheckSquare, Save, ChevronDown,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState, TableSkeleton } from '@/components/states'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { downloadCsv } from '@/lib/print-table'
import { CrmExportMenu } from './crm-export-menu'
import { FilterRail, FilterDrawer, FilterChips, type ActiveFilter } from './filter-panel'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  /** API field used when sorting this column (defaults to key). */
  sortField?: string
  sortable?: boolean
  className?: string
  /** Plain-text value used for export/print when the column has a custom render. */
  printValue?: (row: T) => string
}

// Table-scroll memory keyed by endpoint — restores the exact offset after a
// detail-view round trip (the table remounts on Back).
const TABLE_SCROLL_MEM = new Map<string, number>()

interface Props<T extends { id: string }> {
  title: string
  endpoint: string
  columns: Column<T>[]
  search: string
  onSearchChange: (v: string) => void
  onAdd?: () => void
  onRowClick?: (row: T) => void
  rowActions?: (row: T) => React.ReactNode
  emptyMessage?: string
  items: T[] | null
  loading: boolean
  total?: number
  onReload: () => void
  // Sorting
  sort?: string
  onSortChange?: (sort: string) => void
  // Filter bar slot (rendered by the view: selects, date ranges…)
  filterBar?: React.ReactNode
  filtersActiveCount?: number
  /** Removable chip descriptors for the active filters (shown above the table). */
  activeFilters?: ActiveFilter[]
  onClearFilters?: () => void
  // Import / export
  onImport?: () => void
  exportModule?: string
  exportQuery?: Record<string, string>
  /** Extra classes for the <table> element — e.g. "table-fixed min-w-[2000px]"
   *  for Zoho-style fixed-width columns with horizontal scrolling. */
  tableClassName?: string
  /** Vertical divider between every column (Zoho-style organized grid). */
  columnDividers?: boolean
  // Saved filters (same pattern as VirtualList) — only rendered when provided.
  savedViews?: { id: string; name: string; isDefault: boolean; isShared?: boolean; config: Record<string, unknown> }[]
  onSaveView?: (name: string, isShared: boolean) => void
  onApplyView?: (view: { name: string; config: Record<string, unknown> }) => void
  onDeleteView?: (id: string) => void
  /** Extra bulk actions rendered in the selection bar (receives selected ids). */
  bulkActions?: (selectedIds: string[], clearSelection: () => void) => React.ReactNode
  // Pagination
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
}

/** Saved-filter dropdown shared by the toolbar and the filter panel. */
function SavedViewsMenu({
  savedViews, onApplyView, onSearchChange, onDeleteView,
}: {
  savedViews: { id: string; name: string; isDefault: boolean; isShared?: boolean; config: Record<string, unknown> }[]
  onApplyView?: (view: { name: string; config: Record<string, unknown> }) => void
  onSearchChange: (v: string) => void
  onDeleteView?: (id: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          <Save className="mr-1.5 size-3.5" /> Saved
          <Badge variant="secondary" className="ml-1 px-1.5 font-mono text-[10px]">{savedViews.length}/10</Badge>
          <ChevronDown className="ml-1 size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
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
  )
}

export function CrmTable<T extends { id: string }>({
  title, endpoint, columns, search, onSearchChange, onAdd, onRowClick,
  rowActions, emptyMessage, items, loading, total, onReload,
  sort, onSortChange, filterBar, filtersActiveCount = 0, activeFilters, onClearFilters,
  onImport, exportModule, exportQuery, savedViews, onSaveView, onApplyView, onDeleteView,
  bulkActions, hasMore, loadingMore, onLoadMore, tableClassName, columnDividers,
}: Props<T>) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [hiddenCols, setHiddenCols] = React.useState<Set<string>>(new Set())
  const [saveViewOpen, setSaveViewOpen] = React.useState(false)
  const [viewName, setViewName] = React.useState('')
  const [isShared, setIsShared] = React.useState(false)
  const tableScrollRef = React.useRef<HTMLDivElement>(null)

  // Scroll restore across the detail round trip (same pattern as VirtualList).
  React.useEffect(() => {
    const el = tableScrollRef.current
    if (!el) return
    const saved = TABLE_SCROLL_MEM.get(endpoint) ?? 0
    if (saved > 0) {
      el.scrollTop = saved
      requestAnimationFrame(() => { el.scrollTop = TABLE_SCROLL_MEM.get(endpoint) ?? saved })
    }
    const onScroll = () => { TABLE_SCROLL_MEM.set(endpoint, el.scrollTop) }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [endpoint])

  // Reset selection when the underlying data set changes identity
  const itemIds = React.useMemo(() => (items ?? []).map((i) => i.id).join(','), [items])
  React.useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const next = new Set([...prev].filter((id) => items?.some((i) => i.id === id)))
      return next.size === prev.size ? prev : next
    })
  }, [itemIds])

  const visibleColumns = columns.filter((c) => !hiddenCols.has(c.key))

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
    setSelected((s) => {
      if (items.length > 0 && items.every((i) => s.has(i.id))) {
        return new Set([...s].filter((id) => !items.some((i) => i.id === id)))
      }
      return new Set([...s, ...items.map((i) => i.id)])
    })
  }

  const allSelected = !!items && items.length > 0 && items.every((i) => selected.has(i.id))

  const cellText = (row: T, col: Column<T>): string => {
    if (col.printValue) return col.printValue(row)
    const v = (row as Record<string, unknown>)[col.key]
    if (v === null || v === undefined) return ''
    return String(v)
  }

  const bulkDelete = async () => {
    if (selected.size === 0) return
    const n = selected.size
    const res = await fetch(`${endpoint}/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    })
    if (res.ok) {
      toast.success(`Moved ${n} record${n === 1 ? '' : 's'} to trash`)
      setSelected(new Set())
      onReload()
    } else {
      const j = await res.json().catch(() => null)
      toast.error(j?.error || 'Bulk delete failed')
    }
  }

  const exportSelected = () => {
    if (!items) return
    const rows = items.filter((i) => selected.has(i.id))
    if (rows.length === 0) return
    downloadCsv(
      `${title.toLowerCase()}-selected-${new Date().toISOString().slice(0, 10)}.csv`,
      visibleColumns.map((c) => c.header),
      rows.map((r) => visibleColumns.map((c) => cellText(r, c))),
    )
    toast.success(`Exported ${rows.length} selected records`)
  }

  const headerSortState = (col: Column<T>): string => {
    if (!sort || !col.sortable) return ''
    const field = col.sortField ?? col.key
    if (sort === field) return 'asc'
    if (sort === `-${field}`) return 'desc'
    return ''
  }

  const cycleSort = (col: Column<T>) => {
    if (!onSortChange || !col.sortable) return
    const field = col.sortField ?? col.key
    const state = headerSortState(col) // '' | 'asc' | 'desc'
    onSortChange(state === '' ? field : state === 'asc' ? `-${field}` : field)
  }

  // Shared panel body — rendered inside the desktop rail AND the mobile drawer.
  const hasFilterPanel = !!(filterBar || savedViews)
  const filterPanel = (
    <>
      {savedViews && (
        <SavedViewsMenu
          savedViews={savedViews}
          onApplyView={onApplyView}
          onSearchChange={onSearchChange}
          onDeleteView={onDeleteView}
        />
      )}
      {filterBar}
      {onSaveView && (
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSaveViewOpen(true)}>
          <Save className="mr-1.5 size-3.5" /> Save filter
        </Button>
      )}
    </>
  )

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {hasFilterPanel && (
        <FilterRail activeCount={filtersActiveCount} activeFilters={activeFilters} onClearAll={onClearFilters}>
          {filterPanel}
        </FilterRail>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {total !== undefined && (
              <Badge variant="secondary" className="font-mono text-xs">{total.toLocaleString()}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading…' : `${(items?.length ?? 0).toLocaleString()} loaded${hasMore ? ' — load more below' : ''}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}…`}
              className="h-9 w-full pl-8 sm:w-56"
              aria-label={`Search ${title}`}
            />
          </div>
          <Button variant="outline" size="icon" className="size-9" onClick={onReload} aria-label="Refresh" title="Refresh">
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {hasFilterPanel && (
            <FilterDrawer activeCount={filtersActiveCount} activeFilters={activeFilters} onClearAll={onClearFilters}>
              {filterPanel}
            </FilterDrawer>
          )}
          {onImport && (
            <Button variant="outline" onClick={onImport} title="Import from CSV, Excel, Word, PDF or JSON">
              <Upload className="mr-1.5 size-4" /> Import
            </Button>
          )}
          {exportModule && (
            <CrmExportMenu
              title={title}
              exportModule={exportModule}
              total={total}
              items={items}
              columns={visibleColumns}
              search={search}
              sort={sort}
              exportQuery={exportQuery}
            />
          )}
          {onAdd && (
            <Button onClick={onAdd}>
              <Plus className="mr-1.5 size-4" /> Add
            </Button>
          )}
        </div>
      </div>

      {/* Active filter chips — removable, above the results on every size */}
      <FilterChips filters={activeFilters} onClearAll={onClearFilters} />

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button variant="outline" size="sm" onClick={exportSelected}>
            <Download className="mr-1.5 size-3.5" /> Export
          </Button>
          {bulkActions && bulkActions([...selected], () => setSelected(new Set()))}
          <Button variant="outline" size="sm" onClick={bulkDelete} className="text-destructive">
            <Trash2 className="mr-1.5 size-3.5" /> Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <TableSkeleton rows={6} cols={4} />
          ) : !items || items.length === 0 ? (
            <EmptyState
              icon={Search}
              title={emptyMessage ?? 'No records found'}
              description={
                search || filtersActiveCount > 0
                  ? 'Try adjusting your search or clearing filters.'
                  : undefined
              }
              className="m-3"
            />
          ) : (
            <div ref={tableScrollRef} className="max-h-[70vh] overscroll-contain overflow-auto">
              <table className={`w-full min-w-[48rem] text-sm ${tableClassName ?? ''}`}>
                <thead className="sticky top-0 z-10 border-b border-border bg-background/95 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/75">
                  <tr>
                    <th className="w-10 px-4 py-2.5">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                    </th>
                    {visibleColumns.map((c) => {
                      const sortState = headerSortState(c)
                      return (
                        <th key={c.key} className={`whitespace-nowrap px-4 py-2.5 font-medium ${c.className ?? ''} ${columnDividers ? 'border-l border-border/60' : ''}`}>
                          {c.sortable && onSortChange ? (
                            <button
                              type="button"
                              onClick={() => cycleSort(c)}
                              className="inline-flex max-w-full items-center gap-1 uppercase tracking-wide hover:text-foreground"
                              aria-label={`Sort by ${c.header}`}
                            >
                              {c.header}
                              {sortState === 'asc' && <ArrowUp className="size-3" />}
                              {sortState === 'desc' && <ArrowDown className="size-3" />}
                              {sortState === '' && <ArrowUpDown className="size-3 opacity-40" />}
                            </button>
                          ) : c.header}
                        </th>
                      )
                    })}
                    {rowActions && <th className="w-10 px-4 py-2.5"></th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr
                      key={row.id}
                      className={`border-b transition-colors last:border-0 hover:bg-muted/30 ${selected.has(row.id) ? 'bg-primary/5' : ''} ${onRowClick ? 'cursor-pointer' : ''}`}
                      onClick={() => onRowClick?.(row)}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(row.id)}
                          onCheckedChange={() => toggle(row.id)}
                          aria-label="Select row"
                        />
                      </td>
                      {visibleColumns.map((c) => (
                        <td key={c.key} className={`px-4 py-3 align-top ${c.className ?? ''} ${columnDividers ? 'border-l border-border/60' : ''}`}>
                          {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                        </td>
                      ))}
                      {rowActions && (
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {rowActions(row)}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer: count + load more + column chooser */}
          {items && items.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
              <span>
                Showing <strong className="text-foreground">{items.length.toLocaleString()}</strong> of{' '}
                <strong className="text-foreground">{(total ?? items.length).toLocaleString()}</strong> records
                {selected.size > 0 && <> · {selected.size} selected</>}
              </span>
              <div className="flex items-center gap-2">
                {hasMore && onLoadMore && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onLoadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      <Columns3 className="mr-1 size-3.5" /> Columns
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Visible columns</DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={(e) => { e.preventDefault(); setHiddenCols(new Set()) }}
                      disabled={hiddenCols.size === 0}
                    >
                      <CheckSquare className="mr-2 size-3.5" /> Show all
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {columns.map((c) => (
                      <DropdownMenuItem key={c.key} onSelect={(e) => {
                        e.preventDefault()
                        setHiddenCols((prev) => {
                          const next = new Set(prev)
                          if (next.has(c.key)) next.delete(c.key)
                          else if (visibleColumns.length > 1 || next.has(c.key)) next.add(c.key)
                          return next
                        })
                      }}>
                        <Checkbox checked={!hiddenCols.has(c.key)} className="mr-2" />
                        {c.header}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save filter dialog (only when the view wires saved filters) */}
      {onSaveView && (
        <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save filter</DialogTitle>
              <DialogDescription>Save the current search + filters for quick access.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Filter name</Label>
                <Input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder={`My filtered ${title.toLowerCase()}`} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={isShared} onCheckedChange={(v) => setIsShared(v === true)} />
                Share with team
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSaveViewOpen(false)}>Cancel</Button>
              <Button onClick={() => { onSaveView(viewName, isShared); setSaveViewOpen(false); setViewName('') }}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      </div>
    </div>
  )
}

export function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; class: string }> }) {
  const cfg = map[status] ?? { label: status, class: 'border-border text-muted-foreground' }
  return <Badge variant="outline" className={cfg.class}>{cfg.label}</Badge>
}
