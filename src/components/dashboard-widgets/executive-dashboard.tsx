'use client'

import * as React from 'react'
import { TrendingUp, TrendingDown, Target, Trophy, IndianRupee, Clock, Phone, Mail, Users, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { fmtINRCompact } from '@/lib/money'

interface Widget { type: string; title: string; value: number; format: string; delta: number }
interface Goal { id: string; metric: string; targetAmount: number; actualAmount: number; percentage: number; status: string }
interface ForecastCategory { name: string; amount: number; color: string }
interface LeaderboardEntry { rep: string; revenue: number; deals: number }

function formatValue(val: number, format: string): string {
  if (format === 'currency') return fmtINRCompact(val)
  if (format === 'percent') return `${val.toFixed(0)}%`
  return val.toLocaleString()
}

const METRIC_LABELS: Record<string, string> = {
  revenue: 'Revenue', deals_closed: 'Deals Closed', calls_made: 'Calls Made',
  emails_sent: 'Emails Sent', leads_created: 'Leads Created', meetings_held: 'Meetings Held',
}

export function ExecutiveDashboardView() {
  const [widgets, setWidgets] = React.useState<Widget[] | null>(null)
  const [forecast, setForecast] = React.useState<{ categories: ForecastCategory[]; total: number; scenarios: { bestCase: number; worstCase: number; mostLikely: number } } | null>(null)
  const [goals, setGoals] = React.useState<Goal[] | null>(null)
  const [leaderboard, setLeaderboard] = React.useState<LeaderboardEntry[] | null>(null)

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/dashboards/widgets', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch('/api/forecast', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch('/api/goals', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch('/api/leaderboard', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
    ]).then(([w, f, g, l]) => {
      if (cancelled) return
      setWidgets(w.widgets ?? null)
      setForecast(f.categories ? f : null)
      setGoals(g.goals ?? null)
      setLeaderboard(l.leaderboard ?? null)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Executive Dashboard</h1>
        <p className="text-muted-foreground">Real-time KPIs, forecast, goals, and leaderboard</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {!widgets ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />) :
         widgets.slice(0, 5).map((w) => (
          <Card key={w.title} className="py-4">
            <CardContent>
              <p className="text-xs text-muted-foreground">{w.title}</p>
              <p className="mt-1 text-2xl font-bold">{formatValue(w.value, w.format)}</p>
              {w.delta !== 0 && (
                <p className={`mt-1 flex items-center gap-1 text-xs ${w.delta > 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                  {w.delta > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                  {Math.abs(w.delta)}% vs last period
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {widgets?.slice(5).map((w) => (
          <Card key={w.title} className="py-3">
            <CardContent>
              <p className="text-xs text-muted-foreground">{w.title}</p>
              <p className="mt-0.5 text-lg font-bold">{formatValue(w.value, w.format)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Forecast */}
        <Card>
          <CardHeader><CardTitle className="text-base">Sales Forecast</CardTitle><CardDescription>Current period forecast by category</CardDescription></CardHeader>
          <CardContent>
            {forecast ? (
              forecast.categories.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No open deals to forecast yet</p>
              ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  {forecast.categories.map(c => {
                    const max = Math.max(...forecast.categories.map(x => x.amount), 1)
                    return (
                      <div key={c.name}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{c.name}</span>
                          <span className="text-muted-foreground">{fmtINRCompact(c.amount)}</span>
                        </div>
                        <div className="mt-1 h-4 rounded bg-muted"><div className="h-4 rounded" style={{ width: `${(c.amount / max) * 100}%`, backgroundColor: c.color }} /></div>
                      </div>
                    )
                  })}
                </div>
                <div className="grid grid-cols-3 gap-2 border-t pt-3">
                  <div className="rounded border p-2 text-center"><p className="text-xs text-muted-foreground">Best Case</p><p className="text-sm font-bold text-emerald-500">{fmtINRCompact(forecast.scenarios.bestCase)}</p></div>
                  <div className="rounded border p-2 text-center"><p className="text-xs text-muted-foreground">Most Likely</p><p className="text-sm font-bold">{fmtINRCompact(forecast.scenarios.mostLikely)}</p></div>
                  <div className="rounded border p-2 text-center"><p className="text-xs text-muted-foreground">Worst Case</p><p className="text-sm font-bold text-amber-500">{fmtINRCompact(forecast.scenarios.worstCase)}</p></div>
                </div>
              </div>
              )
            ) : <Skeleton className="h-48 w-full" />}
          </CardContent>
        </Card>

        {/* Goals */}
        <Card>
          <CardHeader><CardTitle className="text-base">Monthly Goals</CardTitle><CardDescription>Progress toward targets</CardDescription></CardHeader>
          <CardContent>
            {goals ? (
              goals.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No goals set yet — create one under Analytics → Goals</p>
              ) : (
              <div className="space-y-4">
                {goals.map(g => (
                  <div key={g.id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{METRIC_LABELS[g.metric] ?? g.metric}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{g.metric === 'revenue' ? fmtINRCompact(g.actualAmount) : g.actualAmount} / {g.metric === 'revenue' ? fmtINRCompact(g.targetAmount) : g.targetAmount}</span>
                        <Badge variant="outline" className={`text-[10px] ${g.status === 'exceeded' ? 'border-emerald-500/40 text-emerald-600' : g.status === 'on_track' ? 'border-blue-500/40 text-blue-600' : 'border-amber-500/40 text-amber-600'}`}>
                          {g.status === 'exceeded' ? '🎉 Exceeded' : g.status === 'on_track' ? 'On Track' : 'Behind'}
                        </Badge>
                      </div>
                    </div>
                    <Progress value={Math.min(g.percentage, 100)} className="mt-1 h-2" />
                    <p className="mt-0.5 text-xs text-muted-foreground">{g.percentage.toFixed(0)}% of target</p>
                  </div>
                ))}
              </div>
              )
            ) : <Skeleton className="h-48 w-full" />}
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Trophy className="size-4 text-amber-500" /> Leaderboard</CardTitle><CardDescription>Top performers by won revenue</CardDescription></CardHeader>
        <CardContent className="p-0">
          {leaderboard ? (
            leaderboard.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No won deals yet</p> :
            <ul className="divide-y">
              {leaderboard.map((entry, i) => (
                <li key={entry.rep} className="flex items-center gap-3 p-3">
                  <div className={`flex size-8 items-center justify-center rounded-full text-sm font-bold ${i === 0 ? 'bg-amber-500/20 text-amber-600' : i === 1 ? 'bg-muted text-muted-foreground' : i === 2 ? 'bg-orange-500/20 text-orange-600' : 'bg-muted text-muted-foreground'}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{entry.rep}</p>
                    <p className="text-xs text-muted-foreground">{entry.deals} deals won</p>
                  </div>
                  <p className="text-sm font-bold">{fmtINRCompact(entry.revenue)}</p>
                </li>
              ))}
            </ul>
          ) : <Skeleton className="h-32 w-full" />}
        </CardContent>
      </Card>
    </div>
  )
}
