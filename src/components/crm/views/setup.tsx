'use client'

import * as React from 'react'
import { Database, DatabaseZap, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

const SEED_PLAN = [
  '250 leads', '120 contacts', '60 accounts', '60 deals', '120 activities', '30 invoices',
  '45 tasks', '60 notes', '35 calls', '20 events',
] as const

export function CrmSetupView() {
  const [totals, setTotals] = React.useState<{ accounts: number; contacts: number; leads: number; deals: number } | null>(null)
  /** Which seed operation is running (drives the progress dialog + button disabling). */
  const [busy, setBusy] = React.useState<'seed' | 'delete' | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState<'seed' | 'delete' | null>(null)

  const loadTotals = React.useCallback(async () => {
    try {
      const [a, c, l, d] = await Promise.all([
        fetch('/api/crm/accounts?limit=1', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/crm/contacts?limit=1', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/crm/leads?limit=1', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/crm/deals?limit=1', { cache: 'no-store' }).then((r) => r.json()),
      ])
      setTotals({
        accounts: a.total ?? 0, contacts: c.total ?? 0,
        leads: l.total ?? 0, deals: d.total ?? 0,
      })
    } catch {
      setTotals({ accounts: 0, contacts: 0, leads: 0, deals: 0 })
    }
  }, [])

  React.useEffect(() => { loadTotals() }, [loadTotals])

  /** POST /api/crm/seed — top-up to targets; shared by the Seed Test Data flow. */
  const seed = async () => {
    if (busy) return
    setBusy('seed')
    try {
      const res = await fetch('/api/crm/seed', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Seeding failed')
      const c = data.created ?? { accounts: 0, contacts: 0, leads: 0, deals: 0, activities: 0, invoices: 0 }
      const total = Object.values(c).reduce((s: number, n) => s + (Number(n) || 0), 0)
      if (total === 0) {
        toast.info('Test data already in place — nothing new to add')
      } else {
        toast.success(`${total} records added`)
      }
      loadTotals()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Seeding failed')
    } finally {
      setBusy(null)
      setConfirmOpen(null)
    }
  }

  /** DELETE /api/crm/seed — removes ONLY isSeed-flagged records. */
  const deleteSeed = async () => {
    if (busy) return
    setBusy('delete')
    try {
      const res = await fetch('/api/crm/seed', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Deleting seed data failed')
      const total = Number(data.total) || 0
      if (total === 0) {
        toast.info('No seed data found — nothing was deleted')
      } else {
        toast.success(`${total} records deleted`)
      }
      loadTotals()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Deleting seed data failed')
    } finally {
      setBusy(null)
      setConfirmOpen(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Setup &amp; Seed</h1>
        <p className="text-muted-foreground">Provision demo CRM data and inspect your pipeline</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Accounts" value={totals?.accounts} />
        <StatCard label="Contacts" value={totals?.contacts} />
        <StatCard label="Leads" value={totals?.leads} />
        <StatCard label="Deals" value={totals?.deals} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <DatabaseZap className="size-5 text-emerald-500" />
            <div>
              <CardTitle className="text-base">Test data</CardTitle>
              <CardDescription>
                Tops up to 250 leads, 120 contacts, 60 accounts, 60 deals, 120 activities, 30 invoices, 45 tasks, 60 notes, 35 calls and 20 calendar events — plus demo inventory, price book, vendors, quotes/orders and campaigns for empty modules (idempotent: modules already at target are skipped). Deleting removes only seeded records.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {/* Seed — secondary with confirm + progress */}
            <AlertDialog open={confirmOpen === 'seed'} onOpenChange={(v) => setConfirmOpen(v ? 'seed' : null)}>
              <AlertDialogTrigger asChild>
                <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirmOpen('seed')}>
                  <DatabaseZap className="mr-2 size-4" /> Seed Test Data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Seed test data?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2">
                      <p>Creates up to:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {SEED_PLAN.map((s) => (
                          <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                        ))}
                      </div>
                      <p className="text-xs">
                        Top-up semantics: modules already at target are skipped, so existing records are never duplicated or overwritten.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={seed} disabled={busy !== null}>
                    {busy === 'seed' ? 'Seeding…' : 'Seed test data'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Delete — destructive outline with confirm + progress */}
            <AlertDialog open={confirmOpen === 'delete'} onOpenChange={(v) => setConfirmOpen(v ? 'delete' : null)}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy !== null}
                  onClick={() => setConfirmOpen('delete')}
                >
                  <Trash2 className="mr-2 size-4" /> Delete All Seed Data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-destructive" /> Delete all seed data?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Removes only records created by Seed Test Data — real data is never touched. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={deleteSeed}
                    disabled={busy !== null}
                  >
                    {busy === 'delete' ? 'Deleting…' : 'Delete seed data'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {totals && (totals.accounts > 0 || totals.leads > 0) && (
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-emerald-500" />
              {totals.leads >= 250 ? 'Test data already seeded' : 'Partial data present — seeding is idempotent and will fill gaps'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Indeterminate progress overlay while a seed operation runs */}
      <SeedProgressDialog busy={busy} />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="size-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Pipeline</CardTitle>
              <CardDescription>Default sales pipeline with 6 stages</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <PipelineStages />
        </CardContent>
      </Card>
    </div>
  )
}

/** Indeterminate progress bar shown while POST/DELETE /api/crm/seed runs. */
function SeedProgressDialog({ busy }: { busy: 'seed' | 'delete' | null }) {
  const open = busy !== null
  const value = useIndeterminateProgress(open)
  const label = busy === 'seed' ? 'Seeding test data…' : 'Deleting seed data…'
  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-sm [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {busy === 'seed'
              ? 'Creating records and linking them together. This usually takes a few seconds.'
              : 'Removing only seed-flagged records. Real data is never touched.'}
          </DialogDescription>
        </DialogHeader>
        <Progress value={value} aria-label={label} />
        <p className="text-xs text-muted-foreground" aria-live="polite">{label}</p>
      </DialogContent>
    </Dialog>
  )
}

/** Cycles 0→95 while active to give a sense of motion for unknown durations. */
function useIndeterminateProgress(active: boolean): number {
  const [value, setValue] = React.useState(0)
  React.useEffect(() => {
    if (!active) { setValue(0); return }
    setValue(10)
    const timer = window.setInterval(() => {
      setValue((v) => (v >= 95 ? 15 : v + Math.max(1.5, (95 - v) * 0.09)))
    }, 200)
    return () => window.clearInterval(timer)
  }, [active])
  return value
}

function StatCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value ?? '—'}</p>
        </div>
        {value !== undefined && value > 0 && <CheckCircle2 className="size-5 text-emerald-500" />}
      </CardContent>
    </Card>
  )
}

function PipelineStages() {
  const [stages, setStages] = React.useState<{ name: string; probability: number; isWonStage: boolean; isLostStage: boolean }[] | null>(null)
  React.useEffect(() => {
    fetch('/api/crm/pipelines', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setStages(d.pipelines?.[0]?.stages ?? []))
      .catch(() => setStages([]))
  }, [])
  if (!stages) return <div className="text-sm text-muted-foreground">Loading…</div>
  return (
    <div className="flex flex-wrap gap-2">
      {stages.map((s, i) => (
        <Badge
          key={s.name}
          variant="outline"
          className={`px-3 py-1.5 ${
            s.isWonStage ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
            : s.isLostStage ? 'border-destructive/40 text-destructive'
            : ''
          }`}
        >
          {i + 1}. {s.name} · {s.probability}%
        </Badge>
      ))}
    </div>
  )
}
