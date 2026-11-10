'use client'

import * as React from 'react'
import { Download, FileJson, FileSpreadsheet, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePermissions } from '@/lib/auth/client-permissions'
import { toast } from 'sonner'
import { printTable } from '@/lib/print-table'
import type { Column } from './crm-table'

interface Props<T extends { id: string }> {
  title: string
  exportModule: string
  total?: number
  items: T[] | null
  columns: Column<T>[]
  search?: string
  sort?: string
  exportQuery?: Record<string, string>
}

/** Server export (respects search/sort/filters) + client print for the loaded page. */
export function CrmExportMenu<T extends { id: string }>({
  title, exportModule, total, items, columns, search, sort, exportQuery,
}: Props<T>) {
  const { canImportExport } = usePermissions()

  const serverExport = async (format: 'csv' | 'json') => {
    try {
      const params = new URLSearchParams({ module: exportModule, format, ...(search ? { search } : {}), ...(sort ? { sort } : {}) })
      for (const [k, v] of Object.entries(exportQuery ?? {})) if (v) params.set(k, v)
      const res = await fetch(`/api/crm/export?${params}`, { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || 'Export failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${exportModule}s-${new Date().toISOString().slice(0, 10)}.${format}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      toast.success(`Exported ${total ?? items?.length ?? 'all'} ${exportModule}s as ${format.toUpperCase()}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    }
  }

  const cellText = (row: T, col: Column<T>): string => {
    if (col.printValue) return col.printValue(row)
    const v = (row as Record<string, unknown>)[col.key]
    return v === null || v === undefined ? '' : String(v)
  }

  const printCurrent = () => {
    if (!items) return
    printTable({
      title,
      headers: columns.map((c) => c.header),
      rows: items.map((r) => columns.map((c) => cellText(r, c))),
      meta: `${items.length} of ${total ?? items.length} records${search ? ` · search: "${search}"` : ''} · generated ${new Date().toLocaleString()}`,
    })
  }

  return (
    <DropdownMenu>
      {/* Admin-only gate: when !canImportExport the trigger renders disabled
          with an "Admin only" tooltip (a disabled button doesn't fire pointer
          events, so it's wrapped in a span for the tooltip to work). */}
      {canImportExport ? (
        <DropdownMenuTrigger asChild>
          <Button variant="outline" title="Export / print">
            <Download className="mr-1.5 size-4" /> Export
          </Button>
        </DropdownMenuTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-not-allowed">
              <Button variant="outline" title="Export / print" disabled>
                <Download className="mr-1.5 size-4" /> Export
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Admin only</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Current view ({(total ?? items?.length ?? 0).toLocaleString()} records)
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => serverExport('csv')}>
          <FileSpreadsheet className="mr-2 size-4" /> CSV (Excel-ready)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => serverExport('json')}>
          <FileJson className="mr-2 size-4" /> JSON
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={printCurrent} disabled={!items || items.length === 0}>
          <Printer className="mr-2 size-4" /> Print / Save as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
