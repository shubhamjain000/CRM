'use client'

import * as React from 'react'
import { TrendingUp, Users, Target, IndianRupee, Clock, BarChart3, Activity, Filter, PhoneCall, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import {
  AXIS_STROKE, AXIS_TICK, compact, GRID_STROKE, PALETTE, TOOLTIP_CONTENT_STYLE, truncate,
} from '../chart-utils'
import { CsmDueLabel, CsmStepBadge } from '@/components/crm/csm-ui'
import { CSM_TONE_CLASSES, type CsmTone } from '@/lib/csm'

interface CsmUpcoming {
  id: string; name: string; account: string | null; owner: string | null
  step: string; dueAt: string | null; overdue: boolean; dueToday: boolean
}

interface CsmResponse {
  totals: { total: number; active: number; overdue: number; dueToday: number; dueThisWeek: number; loopComplete: number; oldLeads: number; loopRate: number }
  distribution: { value: string; tone: CsmTone; count: number }[]
  upcoming: CsmUpcoming[]
  trend: { date: string; label: string; count: number }[]
}

export function AnalyticsDashboardView() {
  const [funnel, setFunnel] = React.useState<{ stages: string[]; values: number[]; conversionRates: { from: string; to: string; rate: number }[] } | null>(null)
  const [winLoss, setWinLoss] = React.useState<{ won: number; lost: number; winRate: number; bySource: { source: string; count: number }[] } | null>(null)
  const [repPerf, setRepPerf] = React.useState<{ reps: { rep: string; deals: number; revenue: number; won: number; winRate: number }[] } | null>(null)
  const [velocity, setVelocity] = React.useState<{ velocity: { stageName: string; color: string; avgDays: number; count: number }[] } | null>(null)
  const [sourceROI, setSourceROI] = React.useState<{ sources: { source: string; totalDeals: number; totalRevenue: number; wonDeals: number; wonRevenue: number }[] } | null>(null)
  const [dealDist, setDealDist] = React.useState<{ labels: string[]; values: number[] } | null>(null)
  const [csm, setCsm] = React.useState<CsmResponse | null>(null)

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/analytics/funnel', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch('/api/analytics/win-loss', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch('/api/analytics/rep-performance', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch('/api/analytics/pipeline-velocity', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch('/api/analytics/source-roi', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch('/api/analytics/deal-distribution', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch('/api/analytics/csm', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
    ]).then(([f, wl, rp, vel, sroi, dd, csmData]) => {
      if (cancelled) return
      setFunnel(f.stages ? f : null)
      setWinLoss(wl.won !== undefined ? wl : null)
      setRepPerf(rp.reps ? rp : null)
      setVelocity(vel.velocity ? vel : null)
      setSourceROI(sroi.sources ? sroi : null)
      setDealDist(dd.labels ? dd : null)
      setCsm(csmData?.totals ? csmData as CsmResponse : null)
    })
    return () => { cancelled = true }
  }, [])

  // Recharts-ready datasets (all fetched data / unwrapping stays untouched).
  const funnelData = React.useMemo(
    () => funnel
      ? funnel.stages.map((s, i) => ({ name: s, value: funnel.values[i] ?? 0 })).sort((a, b) => b.value - a.value)
      : [],
    [funnel],
  )
  const topReps = React.useMemo(
    () => repPerf
      ? [...repPerf.reps]
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 8)
          .map((r) => ({
            name: r.rep.length > 12 ? `…${r.rep.slice(-8)}` : r.rep,
            value: r.revenue,
            deals: r.deals,
            won: r.won,
            winRate: r.winRate,
          }))
      : [],
    [repPerf],
  )
  const velocityData = React.useMemo(
    () => velocity ? velocity.velocity.map((v) => ({ name: v.stageName, value: v.avgDays, count: v.count })) : [],
    [velocity],
  )
  const dealDistData = React.useMemo(
    () => dealDist
      ? dealDist.labels.map((l, i) => ({ name: l, value: dealDist.values[i] ?? 0 })).filter((p) => p.value > 0)
      : [],
    [dealDist],
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">Pre-built sales analytics dashboards</p>
      </div>

      {/* CSM Cadence — updates automatically as reps set the next step on contacts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Activity className="size-4" /> CSM Cadence</CardTitle>
          <CardDescription>Follow-up loop health — fed live by the “Next step” field on contacts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {csm ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{csm.totals.active}</p>
                  <p className="text-xs text-muted-foreground">Active loops</p>
                </div>
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-center">
                  <p className={`text-2xl font-bold ${csm.totals.overdue > 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>{csm.totals.overdue}</p>
                  <p className="text-xs text-muted-foreground">Overdue</p>
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-center">
                  <p className="text-2xl font-bold">{csm.totals.dueToday}</p>
                  <p className="text-xs text-muted-foreground">Due today</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{csm.totals.dueThisWeek}</p>
                  <p className="text-xs text-muted-foreground">Due this week</p>
                </div>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{csm.totals.loopRate}%</p>
                  <p className="text-xs text-muted-foreground">Loops completed ({csm.totals.loopComplete})</p>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Distribution by step */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacts by next step</p>
                  <div className="space-y-2">
                    {csm.distribution.map((d) => {
                      const max = Math.max(...csm.distribution.map((x) => x.count), 1)
                      const tone = CSM_TONE_CLASSES[d.tone] ?? CSM_TONE_CLASSES.slate
                      return (
                        <div key={d.value}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="truncate">{d.value}</span>
                            <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">{d.count}</span>
                          </div>
                          <div className="mt-1 h-2 rounded bg-muted">
                            <div className={`h-2 rounded ${tone.bar}`} style={{ width: `${(d.count / max) * 100}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Today's call list */}
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <PhoneCall className="size-3.5" /> Due now — call list
                  </p>
                  {csm.upcoming.filter((u) => u.overdue || u.dueToday).length === 0 ? (
                    <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-center">
                      <p className="text-sm font-medium">Nothing due today</p>
                      <p className="text-xs text-muted-foreground">Overdue and due-today follow-ups land here automatically.</p>
                    </div>
                  ) : (
                    <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
                      {csm.upcoming.filter((u) => u.overdue || u.dueToday).slice(0, 12).map((u) => (
                        <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{u.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {u.account ?? 'No account'}{u.owner ? ` · ${u.owner}` : ''}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-0.5">
                            <CsmStepBadge step={u.step} />
                            <CsmDueLabel dueAt={u.dueAt} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* 14-day cadence activity */}
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <RefreshCw className="size-3.5" /> Steps set — last 14 days
                </p>
                <div className="flex h-16 items-end gap-1">
                  {csm.trend.map((t) => {
                    const max = Math.max(...csm.trend.map((x) => x.count), 1)
                    return (
                      <div key={t.date} className="group relative flex-1" title={`${t.label}: ${t.count} step${t.count === 1 ? '' : 's'} set`}>
                        <div
                          className={`w-full rounded-t ${t.count > 0 ? 'bg-primary' : 'bg-muted'}`}
                          style={{ height: `${t.count > 0 ? Math.max((t.count / max) * 56, 6) : 3}px` }}
                        />
                      </div>
                    )
                  })}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>{csm.trend[0]?.label}</span>
                  <span>{csm.trend[csm.trend.length - 1]?.label}</span>
                </div>
              </div>
            </>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sales Funnel */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Filter className="size-4" /> Sales Funnel</CardTitle><CardDescription>Lead → Contact → Deal → Won</CardDescription></CardHeader>
          <CardContent>
            {funnel ? (
              <div className="space-y-3">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={funnelData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={96}
                      tick={{ ...AXIS_TICK }}
                      tickFormatter={(v: string) => truncate(v, 14)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} formatter={(v) => compact(Number(v))} cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.4 }} />
                    <Bar dataKey="value" name="Count" radius={[0, 6, 6, 0]} maxBarSize={26}>
                      {funnelData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="space-y-0.5">
                  {funnel.conversionRates.map((c) => (
                    <p key={`${c.from}-${c.to}`} className="text-xs text-muted-foreground">
                      {c.from} → {c.to}: {c.rate.toFixed(1)}% conversion
                    </p>
                  ))}
                </div>
              </div>
            ) : <Skeleton className="h-48 w-full" />}
          </CardContent>
        </Card>

        {/* Win/Loss Analysis */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="size-4" /> Win/Loss Analysis</CardTitle></CardHeader>
          <CardContent>
            {winLoss ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3 text-center"><p className="text-2xl font-bold text-emerald-500">{winLoss.won}</p><p className="text-xs text-muted-foreground">Won</p></div>
                  <div className="rounded-lg border p-3 text-center"><p className="text-2xl font-bold text-destructive">{winLoss.lost}</p><p className="text-xs text-muted-foreground">Lost</p></div>
                  <div className="rounded-lg border p-3 text-center"><p className="text-2xl font-bold">{winLoss.winRate.toFixed(0)}%</p><p className="text-xs text-muted-foreground">Win Rate</p></div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">By Source</p>
                  <div className="space-y-1">
                    {winLoss.bySource.slice(0, 5).map(s => (
                      <div key={s.source} className="flex items-center justify-between text-sm">
                        <span>{s.source}</span>
                        <Badge variant="secondary">{s.count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : <Skeleton className="h-48 w-full" />}
          </CardContent>
        </Card>

        {/* Rep Performance */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="size-4" /> Rep Performance</CardTitle><CardDescription>Top reps by total deal value</CardDescription></CardHeader>
          <CardContent>
            {repPerf ? (
              topReps.length === 0 ? (
                <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">No rep data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={topReps} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={96}
                      tick={{ ...AXIS_TICK }}
                      tickFormatter={(v: string) => truncate(v, 14)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<RepTooltip />} cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.4 }} />
                    <Bar dataKey="value" name="Revenue" fill={PALETTE[0]} radius={[0, 6, 6, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              )
            ) : <Skeleton className="h-48 w-full" />}
          </CardContent>
        </Card>

        {/* Pipeline Velocity */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock className="size-4" /> Pipeline Velocity</CardTitle><CardDescription>Avg time in each stage</CardDescription></CardHeader>
          <CardContent>
            {velocity ? (
              velocityData.length === 0 ? (
                <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">No stage transitions recorded yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={velocityData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="name" tick={{ ...AXIS_TICK }} tickFormatter={(v: string) => truncate(v)} stroke={AXIS_STROKE} tickLine={false} />
                    <YAxis tick={{ ...AXIS_TICK }} tickFormatter={(v: number) => compact(v)} stroke={AXIS_STROKE} tickLine={false} width={40} />
                    <Tooltip content={<VelocityTooltip />} cursor={{ stroke: 'hsl(var(--border))' }} />
                    <Line type="monotone" dataKey="value" name="Avg days in stage" stroke={PALETTE[0]} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )
            ) : <Skeleton className="h-48 w-full" />}
          </CardContent>
        </Card>

        {/* Source ROI */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><IndianRupee className="size-4" /> Source ROI</CardTitle><CardDescription>Revenue by lead source</CardDescription></CardHeader>
          <CardContent className="p-0">
            {sourceROI ? (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b bg-muted/60 text-xs uppercase text-muted-foreground">
                    <tr><th className="px-3 py-2 text-left">Source</th><th className="px-3 py-2 text-right">Deals</th><th className="px-3 py-2 text-right">Revenue</th><th className="px-3 py-2 text-right">Won Rev</th></tr>
                  </thead>
                  <tbody>
                    {sourceROI.sources.map(s => (
                      <tr key={s.source} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2">{s.source}</td>
                        <td className="px-3 py-2 text-right">{s.totalDeals}</td>
                        <td className="px-3 py-2 text-right font-medium">${(s.totalRevenue / 1000).toFixed(0)}K</td>
                        <td className="px-3 py-2 text-right text-emerald-600">${(s.wonRevenue / 1000).toFixed(0)}K</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Skeleton className="h-48 w-full" />}
          </CardContent>
        </Card>

        {/* Deal Size Distribution */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="size-4" /> Deal Size Distribution</CardTitle></CardHeader>
          <CardContent>
            {dealDist ? (
              dealDistData.length === 0 ? (
                <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">No deals to distribute yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={dealDistData} dataKey="value" nameKey="name" outerRadius="75%" stroke="hsl(var(--card))">
                      {dealDistData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} formatter={(v) => compact(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )
            ) : <Skeleton className="h-48 w-full" />}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

interface RepTooltipRow { name: string; value: number; deals: number; won: number; winRate: number }
interface VelocityTooltipRow { name: string; value: number; count: number }

function RepTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0]?.payload as RepTooltipRow | undefined
  if (!p) return null
  return (
    <div className="rounded-lg border px-3 py-2 text-xs shadow-sm" style={{ borderColor: 'hsl(var(--border))', backgroundColor: 'hsl(var(--card))' }}>
      <p className="font-medium">{p.name}</p>
      <p className="text-muted-foreground">Revenue {compact(p.value)} · {p.deals} deals</p>
      <p className="text-muted-foreground">{p.won} won · {p.winRate.toFixed(0)}% win rate</p>
    </div>
  )
}

function VelocityTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0]?.payload as VelocityTooltipRow | undefined
  if (!p) return null
  return (
    <div className="rounded-lg border px-3 py-2 text-xs shadow-sm" style={{ borderColor: 'hsl(var(--border))', backgroundColor: 'hsl(var(--card))' }}>
      <p className="font-medium">{p.name}</p>
      <p className="text-muted-foreground">{p.value}d avg · {p.count} handoffs</p>
    </div>
  )
}
