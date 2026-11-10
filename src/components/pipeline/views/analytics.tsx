'use client'

import * as React from 'react'
import { TrendingUp, Clock, Target, IndianRupee } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { fmtINRCompact } from '@/lib/money'

interface VelocityItem { stageId: string; stageName: string; color: string; avgDays: number; count: number }
interface Metrics {
  totalDeals: number; totalAmount: number; totalWeighted: number; winRate: number
  wonCount: number; lostCount: number
  stages: { stageId: string; stageName: string; count: number; sumAmount: number; weightedValue: number; probability: number; color: string; forecastCategory: string }[]
}

export function PipelineAnalyticsView() {
  const [pipelines, setPipelines] = React.useState<{ id: string; name: string }[]>([])
  const [selectedPipeline, setSelectedPipeline] = React.useState<string>('')
  const [metrics, setMetrics] = React.useState<Metrics | null>(null)
  const [velocity, setVelocity] = React.useState<VelocityItem[] | null>(null)

  React.useEffect(() => {
    fetch('/api/pipelines', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setPipelines(d.pipelines ?? [])
        if (d.pipelines?.[0]) setSelectedPipeline(d.pipelines[0].id)
      })
  }, [])

  React.useEffect(() => {
    if (!selectedPipeline) return
    Promise.all([
      fetch(`/api/pipelines/${selectedPipeline}/metrics`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/pipelines/${selectedPipeline}/velocity`, { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([m, v]) => {
      setMetrics(m)
      setVelocity(v.velocity ?? [])
    }).catch(() => { setMetrics(null); setVelocity([]) })
  }, [selectedPipeline])

  const maxVelocity = velocity ? Math.max(...velocity.map((v) => v.avgDays), 1) : 1

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline Analytics</h1>
          <p className="text-muted-foreground">Velocity, conversion, and win-rate insights</p>
        </div>
        <select
          value={selectedPipeline}
          onChange={(e) => setSelectedPipeline(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Summary cards */}
      {metrics ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={IndianRupee} label="Total pipeline" value={fmtINRCompact(metrics.totalAmount)} />
          <StatCard icon={TrendingUp} label="Weighted forecast" value={fmtINRCompact(metrics.totalWeighted)} />
          <StatCard icon={Target} label="Win rate" value={`${metrics.winRate.toFixed(0)}%`} sub={`${metrics.wonCount} won / ${metrics.lostCount} lost`} />
          <StatCard icon={Clock} label="Total deals" value={String(metrics.totalDeals)} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pipeline by stage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline by stage</CardTitle>
            <CardDescription>Deal count + value per stage</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics ? (
              <div className="space-y-3">
                {metrics.stages.map((s) => {
                  const maxCount = Math.max(...metrics.stages.map((x) => x.count), 1)
                  return (
                    <div key={s.stageId}>
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                          <span className="font-medium">{s.stageName}</span>
                          <span className="text-xs text-muted-foreground">{s.probability}%</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span>{s.count} deals</span>
                          <span className="font-medium">${(s.sumAmount / 1000).toFixed(0)}K</span>
                        </div>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-muted">
                        <div className="h-2 rounded-full" style={{ width: `${(s.count / maxCount) * 100}%`, backgroundColor: s.color }} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">Weighted: ${(s.weightedValue / 1000).toFixed(0)}K</p>
                    </div>
                  )
                })}
              </div>
            ) : <Skeleton className="h-48 w-full" />}
          </CardContent>
        </Card>

        {/* Velocity chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stage velocity</CardTitle>
            <CardDescription>Average time deals spend in each stage</CardDescription>
          </CardHeader>
          <CardContent>
            {velocity ? (
              <div className="space-y-3">
                {velocity.map((v) => (
                  <div key={v.stageId}>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: v.color }} />
                        <span className="font-medium">{v.stageName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium">{v.avgDays}d</span>
                        <span className="text-muted-foreground">({v.count})</span>
                      </div>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full" style={{ width: `${(v.avgDays / maxVelocity) * 100}%`, backgroundColor: v.color }} />
                    </div>
                  </div>
                ))}
                {velocity.every((v) => v.avgDays === 0) && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No transition data yet</p>
                )}
              </div>
            ) : <Skeleton className="h-48 w-full" />}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
