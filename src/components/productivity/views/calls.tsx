'use client'

import * as React from 'react'
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Plus, Users, ListChecks,
  PhoneCall, Clock3, AlertCircle, Inbox, Trash2, Loader2, PhoneForwarded, ArrowRightLeft,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { useAuth } from '@/store/auth'
import { CALL_LOGGED_EVENT, formatDuration, formatDurationLabel } from '@/lib/call-tracking'
import { CallTransferDialog } from '@/components/productivity/call-transfer-dialog'

interface Call {
  id: string; subject: string; callType: string; outcome: string
  duration: number; notes: string | null; startedAt: string; relatedModule: string | null
  ownerId: string
  transferredFromId?: string | null
  transferredToId?: string | null
  transferredAt?: string | null
}

interface AnalyticsRow {
  userId: string; name: string; email: string
  callsMade: number; received: number; connected: number; talkTimeSeconds: number; backlog: number
}

interface Analytics {
  range: string
  connectedThresholdSeconds: number
  members: AnalyticsRow[]
  totals: { callsMade: number; received: number; connected: number; talkTimeSeconds: number; backlog: number }
}

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
] as const

const OUTCOME_COLORS: Record<string, string> = {
  connected: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  voicemail: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  no_answer: 'border-muted-foreground/30 text-muted-foreground',
  busy: 'border-destructive/40 text-destructive',
}

export function CallsView() {
  const { user, permissions } = useAuth()
  // Call transfer is admin-only (owners resolve to admin via the `*` wildcard).
  const canTransfer = permissions.includes('org.admin') || permissions.includes('*')
  const [calls, setCalls] = React.useState<Call[] | null>(null)
  const [analytics, setAnalytics] = React.useState<Analytics | null>(null)
  const [range, setRange] = React.useState<string>('today')
  const [loadingAnalytics, setLoadingAnalytics] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState({ subject: '', callType: 'outbound', outcome: 'connected', notes: '', relatedModule: '' })

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/productivity/calls', { cache: 'no-store' })
      const data = await res.json()
      setCalls(data.calls ?? [])
    } catch {
      setCalls([])
    }
  }, [])

  const loadAnalytics = React.useCallback(async (r: string) => {
    setLoadingAnalytics(true)
    try {
      const res = await fetch(`/api/productivity/calls/analytics?range=${encodeURIComponent(r)}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load analytics')
      setAnalytics(data as Analytics)
    } catch {
      setAnalytics(null)
    } finally {
      setLoadingAnalytics(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])
  React.useEffect(() => { loadAnalytics(range) }, [loadAnalytics, range])

  // Refresh after the CallTracker auto-logs a call (custom event keeps views decoupled).
  React.useEffect(() => {
    const refresh = () => { load(); loadAnalytics(range) }
    window.addEventListener(CALL_LOGGED_EVENT, refresh)
    return () => window.removeEventListener(CALL_LOGGED_EVENT, refresh)
  }, [load, loadAnalytics, range])

  const logCall = async () => {
    try {
      const res = await fetch('/api/productivity/calls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          duration: 0,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Call logged')
      setOpen(false)
      setForm({ subject: '', callType: 'outbound', outcome: 'connected', notes: '', relatedModule: '' })
      load()
      loadAnalytics(range)
    } catch {
      toast.error('Failed')
    }
  }

  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const deleteCall = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/productivity/calls/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      toast.success('Call log removed')
      load()
      loadAnalytics(range)
    } catch {
      toast.error('Could not remove the call log')
    } finally {
      setDeletingId(null)
    }
  }

  const memberName = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const m of analytics?.members ?? []) map.set(m.userId, m.name)
    return map
  }, [analytics])

  // Admin-only call transfer dialog state. The dialog (CallTransferDialog)
  // handles member selection, search, notes and submission; we just open it
  // from a row and refresh the list when it reports a successful handoff.
  const [transferTarget, setTransferTarget] = React.useState<Call | null>(null)

  const totals = analytics?.totals

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Calls</h1>
          <p className="text-sm text-muted-foreground">{calls?.length ?? 0} calls logged</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-1.5 size-4" /> Log call</Button>
      </div>

      {/* Team performance — analysis table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4 text-muted-foreground" aria-hidden />
                Team performance
              </CardTitle>
              <CardDescription className="mt-1">
                Calls made, received, connected, talk time and backlog per member.
              </CardDescription>
            </div>
            <div
              className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
              role="group"
              aria-label="Analytics range"
            >
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRange(r.value)}
                  aria-pressed={range === r.value}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    range === r.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* KPI tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { icon: PhoneCall, label: 'Calls made', value: totals?.callsMade, accent: 'text-foreground' },
              { icon: Inbox, label: 'Received', value: totals?.received, accent: 'text-sky-600 dark:text-sky-400' },
              { icon: PhoneOutgoing, label: 'Connected', value: totals?.connected, accent: 'text-emerald-600 dark:text-emerald-400' },
              { icon: Clock3, label: 'Talk time', value: totals?.talkTimeSeconds, format: true, accent: 'text-foreground' },
              { icon: AlertCircle, label: 'Backlog', value: totals?.backlog, accent: 'text-amber-600 dark:text-amber-400' },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-lg border bg-muted/30 p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <kpi.icon className={`size-3.5 ${kpi.accent}`} aria-hidden />
                  {kpi.label}
                </p>
                {loadingAnalytics || (!analytics && kpi.value === undefined) ? (
                  <Skeleton className="mt-1.5 h-7 w-14" />
                ) : (
                  <p className={`mt-0.5 text-xl font-semibold tabular-nums ${kpi.accent}`}>
                    {kpi.format ? formatDurationLabel(kpi.value ?? 0) : (kpi.value ?? 0)}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Analysis table */}
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table className="w-full min-w-[680px] text-sm">
              <caption className="sr-only">
                Team call analysis: calls made, received, connected, talk time in seconds and backlog per member
              </caption>
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">Member</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Calls made</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Received</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Connected</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Talk time (s)</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Backlog</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {!analytics ? (
                  <tr>
                    <td colSpan={6} className="p-4">
                      <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                      </div>
                    </td>
                  </tr>
                ) : analytics.members.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No team members</td></tr>
                ) : (
                  analytics.members.map((m) => {
                    const isMe = m.userId === user?.id
                    return (
                      <tr key={m.userId} className={isMe ? 'bg-muted/40' : undefined}>
                        <td className="px-3 py-2.5">
                          <div className="max-w-[180px]">
                            <span className="block truncate font-medium">{m.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{m.callsMade}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-sky-600 dark:text-sky-400">{m.received}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{m.connected}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {m.talkTimeSeconds}
                          {m.talkTimeSeconds > 0 && (
                            <span className="ml-1.5 text-xs text-muted-foreground">({formatDurationLabel(m.talkTimeSeconds)})</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {m.backlog > 0 ? (
                            <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
                              {m.backlog}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
                {analytics && analytics.members.length > 0 && (
                  <tr className="border-t-2 bg-muted/60 font-medium">
                    <td className="px-3 py-2.5">Team total</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{analytics.totals.callsMade}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{analytics.totals.received}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{analytics.totals.connected}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{analytics.totals.talkTimeSeconds}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{analytics.totals.backlog}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Connected = dials that crossed the {analytics?.connectedThresholdSeconds ?? 10}s connect
            threshold — talk time starts counting at connect, so the first{' '}
            {analytics?.connectedThresholdSeconds ?? 10}s (ring) never counts. Backlog = open tasks
            still pending after 12 AM IST on their due day.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="size-4 text-muted-foreground" aria-hidden />
            Call history
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!calls ? (
            <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : calls.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No calls logged yet</div>
          ) : (
            <ul className="max-h-[480px] divide-y overflow-y-auto">
              {calls.map((call) => (
                <li key={call.id} className="flex flex-wrap items-center gap-4 gap-y-2 p-4">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    {call.callType === 'inbound' ? <PhoneIncoming className="size-4 text-blue-500" />
                      : call.callType === 'missed' ? <PhoneMissed className="size-4 text-destructive" />
                      : <PhoneOutgoing className="size-4 text-emerald-500" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {call.subject}
                      {call.ownerId && memberName.get(call.ownerId) && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          · {memberName.get(call.ownerId)}{call.ownerId === user?.id ? ' (you)' : ''}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {new Date(call.startedAt).toLocaleString()} ·
                      {call.outcome === 'connected' && <span className="ml-1">talk</span>}
                      <span className="ml-1 font-mono tabular-nums">{formatDuration(call.duration)}</span>
                      {call.duration > 0 && <span className="ml-1">({formatDurationLabel(call.duration)})</span>}
                      {call.relatedModule && <span className="ml-1">· {call.relatedModule}</span>}
                    </p>
                  </div>
                  <Badge variant="outline" className={`shrink-0 ${OUTCOME_COLORS[call.outcome] ?? ''}`}>{call.outcome}</Badge>
                  {call.transferredToId && call.transferredAt && (
                    <Badge
                      variant="secondary"
                      className="max-w-[150px] shrink-0 gap-1 truncate bg-primary/8 text-primary dark:bg-primary/15 dark:text-primary sm:max-w-[220px]"
                      title={`Transferred ${new Date(call.transferredAt).toLocaleString()}`}
                    >
                      <ArrowRightLeft className="size-3" aria-hidden />
                      {call.transferredFromId && memberName.get(call.transferredFromId)
                        ? `${memberName.get(call.transferredFromId)} → ${memberName.get(call.transferredToId) ?? 'new owner'}`
                        : `→ ${memberName.get(call.transferredToId) ?? 'new owner'}`}
                    </Badge>
                  )}
                  {canTransfer && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 shrink-0 gap-1.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setTransferTarget(call)}
                      aria-label="Transfer call"
                      title="Transfer this call to another member (admin)"
                    >
                      <PhoneForwarded className="size-4" aria-hidden />
                      <span className="hidden sm:inline">Transfer</span>
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteCall(call.id)}
                    disabled={deletingId === call.id}
                    aria-label="Remove call log"
                    title="Remove this call log"
                  >
                    {deletingId === call.id
                      ? <Loader2 className="size-4 animate-spin" aria-hidden />
                      : <Trash2 className="size-4" aria-hidden />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log call</DialogTitle>
            <DialogDescription>Record a call you made or received.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.callType} onValueChange={(v) => setForm({ ...form, callType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outbound">Outbound</SelectItem>
                    <SelectItem value="inbound">Inbound</SelectItem>
                    <SelectItem value="missed">Missed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Outcome</Label>
                <Select value={form.outcome} onValueChange={(v) => setForm({ ...form, outcome: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="connected">Connected</SelectItem>
                    <SelectItem value="voicemail">Voicemail</SelectItem>
                    <SelectItem value="no_answer">No answer</SelectItem>
                    <SelectItem value="busy">Busy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={logCall} disabled={!form.subject}>Log call</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canTransfer && (
        <CallTransferDialog
          open={!!transferTarget}
          onOpenChange={(o) => { if (!o) setTransferTarget(null) }}
          callId={transferTarget?.id ?? null}
          currentOwnerId={transferTarget?.ownerId}
          callLabel={transferTarget?.subject}
          onTransferred={() => { load(); loadAnalytics(range) }}
        />
      )}
    </div>
  )
}
