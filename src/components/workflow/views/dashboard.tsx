'use client'

import * as React from 'react'
import { Activity, CheckCircle2, XCircle, Clock, RefreshCw, Trash2, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { safeJsonParse } from '@/components/safe-json'

interface Execution {
  id: string; status: string; targetModule: string; targetId: string
  startedAt: string; completedAt: string | null; errorMessage: string | null
  actionsExecuted: string
}

interface Workflow { id: string; name: string; triggerType: string; isActive: boolean; runCount: number; errorCount: number }

interface Metrics { totalRuns: number; successRate: number; errorCount: number; lastRunAt?: string | null }

export function WorkflowDashboardView() {
  const [workflows, setWorkflows] = React.useState<Workflow[] | null>(null)
  const [selectedId, setSelectedId] = React.useState('')
  const [executions, setExecutions] = React.useState<Execution[] | null>(null)
  const [metrics, setMetrics] = React.useState<Metrics | null>(null)
  const [loadError, setLoadError] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState<Workflow | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const loadWorkflows = React.useCallback(async (): Promise<Workflow[]> => {
    try {
      const res = await fetch('/api/workflows', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load workflows')
      const list: Workflow[] = data.workflows ?? []
      setWorkflows(list)
      setLoadError(false)
      return list
    } catch {
      setWorkflows([])
      setLoadError(true)
      return []
    }
  }, [])

  const loadDetail = React.useCallback(async (id: string) => {
    // Fetch history and metrics independently so one failure can't leave the
    // whole dashboard stuck on skeletons forever.
    fetch(`/api/workflows/${id}/history`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((h) => setExecutions(h.executions ?? []))
      .catch(() => setExecutions([]))
    fetch(`/api/workflows/${id}/history?metrics=true`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((m) => {
        // Guard: a failed request returns {error}, not a metrics object.
        setMetrics(m && typeof m.totalRuns === 'number' ? m : { totalRuns: 0, successRate: 0, errorCount: 0 })
      })
      .catch(() => setMetrics({ totalRuns: 0, successRate: 0, errorCount: 0 }))
  }, [])

  const bootstrap = React.useCallback(async () => {
    setRefreshing(true)
    setExecutions(null)
    setMetrics(null)
    const list = await loadWorkflows()
    const current = list.find((w) => w.id === selectedId) ?? list[0]
    if (current) {
      setSelectedId(current.id)
      await loadDetail(current.id)
    } else {
      setSelectedId('')
    }
    setRefreshing(false)
  }, [loadWorkflows, loadDetail, selectedId])

  React.useEffect(() => { bootstrap() }, []) // bootstrap once on mount

  const onSelectedChange = (id: string) => {
    setSelectedId(id)
    setExecutions(null)
    setMetrics(null)
    loadDetail(id)
  }

  const selected = workflows?.find((w) => w.id === selectedId)
  const noWorkflows = workflows !== null && workflows.length === 0

  const performDelete = async () => {
    if (!confirmDelete) return
    const wf = confirmDelete
    setConfirmDelete(null)
    setDeleting(true)
    try {
      const res = await fetch(`/api/workflows/${wf.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error || 'Could not delete workflow')
        return
      }
      toast.success('Workflow deleted')
      // Reload the list; bootstrap falls back to the first remaining workflow
      // (or the empty state) when the deleted one was selected.
      await bootstrap()
    } catch {
      toast.error('Could not delete workflow')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Execution Dashboard</h1>
          <p className="text-muted-foreground">Monitor workflow runs + performance</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {workflows && workflows.length > 0 && (
            <Select value={selectedId} onValueChange={onSelectedChange}>
              <SelectTrigger className="w-40 sm:w-56" aria-label="Select workflow"><SelectValue placeholder="Select workflow" /></SelectTrigger>
              <SelectContent>
                {workflows.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="icon"
            className="size-9 shrink-0 text-destructive"
            onClick={() => setConfirmDelete(selected ?? null)}
            disabled={!selected || deleting}
            aria-label="Delete workflow"
            title="Delete workflow"
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
          <Button variant="outline" size="icon" className="size-9 shrink-0" onClick={bootstrap} disabled={refreshing} aria-label="Refresh dashboard" title="Refresh">
            <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
          </Button>
        </div>
      </div>

      {loadError && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-destructive">
            <XCircle className="size-4 shrink-0" aria-hidden />
            Couldn&apos;t load workflows. <Button variant="ghost" size="sm" className="h-7 px-2" onClick={bootstrap}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {noWorkflows && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Zap className="size-5 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm font-medium">No workflows yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create your first automation under <span className="font-medium text-foreground">Automation → Workflows</span> —
              every run will show up here with success rate and errors.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Metrics */}
      {metrics && !noWorkflows ? (
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard icon={Activity} label="Total runs" value={String(metrics.totalRuns ?? 0)} />
          <StatCard icon={CheckCircle2} label="Success rate" value={`${Number(metrics.successRate ?? 0).toFixed(0)}%`} color="text-emerald-500" />
          <StatCard icon={XCircle} label="Errors" value={String(metrics.errorCount ?? 0)} color="text-destructive" />
          <StatCard icon={Clock} label="Status" value={selected?.isActive ? 'Active' : selected ? 'Inactive' : '—'} />
        </div>
      ) : !noWorkflows ? (
        <div className="grid gap-4 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : null}

      {/* Execution history */}
      {!noWorkflows && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Execution History</CardTitle>
            <CardDescription>Last 100 runs{selected ? ` · ${selected.name}` : ''}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {!executions ? <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div> :
             executions.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">No executions yet. Run a test from the builder.</div> :
             <ul className="divide-y max-h-96 overflow-y-auto">
               {executions.map((e) => {
                 const actions = safeJsonParse<{ action: string; status: string; error?: string }[]>(e.actionsExecuted, [])
                 return (
                   <li key={e.id} className="flex items-center gap-3 p-3">
                     <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${e.status === 'completed' ? 'bg-emerald-500/10' : e.status === 'failed' ? 'bg-destructive/10' : 'bg-amber-500/10'}`}>
                       {e.status === 'completed' ? <CheckCircle2 className="size-4 text-emerald-500" /> :
                        e.status === 'failed' ? <XCircle className="size-4 text-destructive" /> :
                        <Clock className="size-4 text-amber-500" />}
                     </div>
                     <div className="min-w-0 flex-1">
                       <div className="flex items-center gap-2">
                         <span className="text-sm font-medium capitalize">{e.targetModule}</span>
                         <Badge variant="outline" className="text-[10px]">{e.status}</Badge>
                       </div>
                       <p className="text-xs text-muted-foreground">
                         {new Date(e.startedAt).toLocaleString()} · {actions.length} actions
                         {e.errorMessage && <span className="text-destructive"> · {e.errorMessage}</span>}
                       </p>
                     </div>
                   </li>
                 )
               })}
             </ul>}
          </CardContent>
        </Card>
      )}

      {/* Delete confirmation (exact product copy) */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {confirmDelete?.name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete} className={buttonVariants({ variant: 'destructive' })} disabled={deleting}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color?: string }) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-center gap-3">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted ${color ?? 'text-muted-foreground'}`}>
          <Icon className="size-5" aria-hidden />
        </div>
        <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value}</p></div>
      </CardContent>
    </Card>
  )
}
