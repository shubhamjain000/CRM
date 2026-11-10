'use client'

import * as React from 'react'
import {
  Plus, Play, Download, Trash2, FileText, Pencil, RefreshCw, Database, BarChart3,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  AXIS_STROKE, AXIS_TICK, compact, GRID_STROKE, PALETTE, TOOLTIP_CONTENT_STYLE, truncate,
} from '../chart-utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { ReportFormDialog } from '../report-form-dialog'

interface Report {
  id: string
  name: string
  description?: string | null
  sourceModel: string
  chartType: string
  fields: string
  filters: string
  groupBy: string
  aggregates: string
  limit: number
  lastRunAt?: string | null
  _count?: { executions: number }
}

interface ExecResult {
  columns: { field: string; label: string }[]
  rows: Record<string, unknown>[]
  total: number
  chartData: unknown
}

export function ReportBuilderView() {
  const [reports, setReports] = React.useState<Report[] | null>(null)
  const [selected, setSelected] = React.useState<Report | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Report | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<Report | null>(null)
  const [result, setResult] = React.useState<ExecResult | null>(null)
  const [executing, setExecuting] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/reports', { cache: 'no-store' })
      const data = await res.json()
      setReports(data.reports ?? [])
    } catch { setReports([]) }
  }, [])
  React.useEffect(() => { load() }, [load])

  const openNew = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (r: Report) => { setEditing(r); setFormOpen(true) }

  const run = React.useCallback(async (report: Report) => {
    setSelected(report)
    setResult(null)
    setExecuting(true)
    try {
      const res = await fetch(`/api/reports/${report.id}/execute`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data as ExecResult)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to run report')
    } finally {
      setExecuting(false)
    }
  }, [])

  // Auto-run a freshly-created report.
  const onSaved = React.useCallback(async (id: string) => {
    await load()
    const res = await fetch(`/api/reports/${id}`, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      const r = data.report as Report | undefined
      if (r) run(r)
    }
  }, [load, run])

  const exportCsv = (id: string) => {
    window.open(`/api/reports/${id}/export?format=csv`, '_blank')
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      const res = await fetch(`/api/reports/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      toast.success('Report deleted')
      if (selected?.id === deleteTarget.id) { setSelected(null); setResult(null) }
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">Build BI-grade reports from any CRM module.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1.5 size-4" /> Refresh</Button>
          <Button onClick={openNew}><Plus className="mr-1.5 size-4" /> New report</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Report list */}
        <div className="space-y-2">
          {!reports ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />) :
           reports.length === 0 ? (
             <Card className="border-dashed">
               <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                 <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><FileText className="size-5" /></div>
                 <p className="text-sm font-medium">No reports yet</p>
                 <p className="text-xs text-muted-foreground">Create your first report to analyse deals, leads, calls and more.</p>
                 <Button size="sm" className="mt-2" onClick={openNew}><Plus className="mr-1 size-4" /> New report</Button>
               </CardContent>
             </Card>
           ) : reports.map((r) => (
            <div
              key={r.id}
              className={`group rounded-lg border p-3 transition ${selected?.id === r.id ? 'border-primary bg-muted/30' : 'hover:bg-muted/30'}`}
            >
              <button onClick={() => run(r)} className="w-full text-left">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate font-medium">{r.name}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground capitalize">{r.sourceModel} · {r.chartType} · {r._count?.executions ?? 0} runs</p>
              </button>
              <div className="mt-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openEdit(r)}><Pencil className="mr-1 size-3" /> Edit</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => setDeleteTarget(r)}><Trash2 className="mr-1 size-3" /> Delete</Button>
              </div>
            </div>
          ))}
        </div>

        {/* Report preview */}
        <div className="space-y-4">
          {selected ? (
            <>
              <Card>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{selected.name}</CardTitle>
                    <CardDescription className="capitalize">{selected.sourceModel} · {selected.chartType}</CardDescription>
                    {selected.description && <p className="mt-1 text-xs text-muted-foreground">{selected.description}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="outline" onClick={() => openEdit(selected)}><Pencil className="mr-1 size-3.5" /> Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => exportCsv(selected.id)}><Download className="mr-1 size-3.5" /> CSV</Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeleteTarget(selected)}><Trash2 className="size-3.5" /></Button>
                  </div>
                </CardHeader>
              </Card>

              {executing ? (
                <Card><CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" /> Running report…</CardContent></Card>
              ) : result ? (
                <>
                  {result.chartData && selected.chartType !== 'none' && (
                    <Card>
                      <CardHeader><CardTitle className="text-sm">Chart</CardTitle></CardHeader>
                      <CardContent>
                        <ChartView chartType={selected.chartType} data={result.chartData as ChartData} />
                      </CardContent>
                    </Card>
                  )}
                  <Card>
                    <CardHeader className="flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-sm">Data</CardTitle>
                      <Badge variant="secondary">{result.total} rows</Badge>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="max-h-96 overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 border-b bg-muted/60">
                            <tr>{result.columns.map((c) => <th key={c.field} className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">{c.label}</th>)}</tr>
                          </thead>
                          <tbody>
                            {result.rows.slice(0, 50).map((row, i) => (
                              <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                {result.columns.map((c) => <td key={c.field} className="px-3 py-2">{formatValue(row[c.field])}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card><CardContent className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                  <Play className="size-5" />
                  Click the report name to run it.
                </CardContent></Card>
              )}
            </>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                <Database className="size-6" />
                <p>Select a report from the list, or create a new one.</p>
                <Button size="sm" variant="outline" className="mt-1" onClick={openNew}><Plus className="mr-1 size-4" /> New report</Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ReportFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        onSaved={onSaved}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this report?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteTarget?.name}</span> will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—'
  if (val instanceof Date) return val.toLocaleString()
  if (typeof val === 'object') return JSON.stringify(val).slice(0, 50)
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return val.toLocaleString()
    return val.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  return String(val)
}

interface ChartData {
  labels: string[]
  datasets: { label?: string; data: number[] }[]
  stages?: string[]
  values?: number[]
}

interface ChartPoint { name: string; value: number }

function ChartEmptyState() {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      No data for this chart yet
    </div>
  )
}

function ChartView({ chartType, data }: { chartType: string; data: ChartData }) {
  // Normalise both backend shapes ({labels, datasets} and {stages, values})
  // into recharts-friendly {name, value} points.
  const points: ChartPoint[] = React.useMemo(() => {
    if (data.stages && data.stages.length > 0) {
      return data.stages.map((stage, i) => ({ name: stage, value: Number(data.values?.[i] ?? 0) }))
    }
    const labels = data.labels ?? []
    const values = data.datasets[0]?.data ?? []
    return labels.map((label, i) => ({ name: String(label), value: Number(values[i] ?? 0) }))
  }, [data])

  if (points.length === 0) return <ChartEmptyState />

  if (chartType === 'pie' || chartType === 'donut') {
    const isDonut = chartType === 'donut'
    const total = points.reduce((sum, p) => sum + p.value, 0)
    return (
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={points}
            dataKey="value"
            nameKey="name"
            innerRadius={isDonut ? '55%' : 0}
            outerRadius="80%"
            paddingAngle={isDonut ? 2 : 0}
            stroke="hsl(var(--card))"
          >
            {points.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} formatter={(v) => compact(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {isDonut && (
            <>
              <text x="50%" y="47%" textAnchor="middle" dominantBaseline="central" fill="hsl(var(--foreground))" fontSize={20} fontWeight={600}>
                {compact(total)}
              </text>
              <text x="50%" y="58%" textAnchor="middle" dominantBaseline="central" fill="hsl(var(--muted-foreground))" fontSize={11}>
                Total
              </text>
            </>
          )}
        </PieChart>
      </ResponsiveContainer>
    )
  }

  if (chartType === 'funnel') {
    const sorted = [...points].sort((a, b) => b.value - a.value)
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ ...AXIS_TICK }}
            tickFormatter={(v: string) => truncate(v, 14)}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} formatter={(v) => compact(Number(v))} cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.4 }} />
          <Bar dataKey="value" name="Count" radius={[0, 6, 6, 0]} maxBarSize={28}>
            {sorted.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  if (chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="name" tick={{ ...AXIS_TICK }} tickFormatter={(v: string) => truncate(v)} stroke={AXIS_STROKE} tickLine={false} />
          <YAxis tick={{ ...AXIS_TICK }} tickFormatter={(v: number) => compact(v)} stroke={AXIS_STROKE} tickLine={false} width={48} />
          <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} formatter={(v) => compact(Number(v))} />
          <Line
            type="monotone"
            dataKey="value"
            name={data.datasets[0]?.label ?? 'Value'}
            stroke={PALETTE[0]}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  // bar (default)
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="name" tick={{ ...AXIS_TICK }} tickFormatter={(v: string) => truncate(v)} stroke={AXIS_STROKE} tickLine={false} />
        <YAxis tick={{ ...AXIS_TICK }} tickFormatter={(v: number) => compact(v)} stroke={AXIS_STROKE} tickLine={false} width={48} />
        <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} formatter={(v) => compact(Number(v))} cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.4 }} />
        <Bar dataKey="value" name={data.datasets[0]?.label ?? 'Value'} fill={PALETTE[0]} radius={[6, 6, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  )
}
