'use client'

import * as React from 'react'
import { CheckCircle2, AlertTriangle, Clock, TrendingUp, GitBranch } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface Execution {
  id: string; dealId: string; enteredStateAt: string; hoursInState: number; isStuck: boolean
  deal: { id: string; name: string; amount: number; ownerId: string }
  currentState: { stage: { name: string; color: string }; timeLimitHours: number | null } | null
  blueprint: { name: string }
}

interface Compliance {
  totalDeals: number; inBlueprint: number; complianceRate: number; completed: number; stuckCount: number
}

export function BlueprintDashboardView() {
  const [executions, setExecutions] = React.useState<Execution[] | null>(null)
  const [compliance, setCompliance] = React.useState<Compliance | null>(null)
  const [stuckOnly, setStuckOnly] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const [execRes, compRes] = await Promise.all([
        fetch(`/api/blueprints/stuck?stuckOnly=${stuckOnly}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/blueprints/compliance', { cache: 'no-store' }).then((r) => r.json()),
      ])
      setExecutions(execRes.executions ?? [])
      setCompliance(compRes)
    } catch {
      setExecutions([])
    }
  }, [stuckOnly])

  React.useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Blueprint Dashboard</h1>
          <p className="text-muted-foreground">Monitor execution + compliance</p>
        </div>
        <Button variant={stuckOnly ? 'default' : 'outline'} size="sm" onClick={() => setStuckOnly(!stuckOnly)}>
          <AlertTriangle className="mr-1.5 size-4" /> Stuck only
        </Button>
      </div>

      {/* Compliance stats */}
      {compliance ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={GitBranch} label="Total deals" value={String(compliance.totalDeals)} />
          <StatCard icon={CheckCircle2} label="In blueprint" value={String(compliance.inBlueprint)} sub={`${compliance.complianceRate.toFixed(0)}% compliance`} color="text-emerald-500" />
          <StatCard icon={TrendingUp} label="Completed" value={String(compliance.completed)} color="text-blue-500" />
          <StatCard icon={AlertTriangle} label="Stuck" value={String(compliance.stuckCount)} color="text-amber-500" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      )}

      {/* Execution list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active executions</CardTitle>
          <CardDescription>{executions?.length ?? 0} deals in progress</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!executions ? (
            <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : executions.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {stuckOnly ? 'No stuck deals — all on track!' : 'No active executions'}
            </div>
          ) : (
            <ul className="divide-y">
              {executions.map((e) => (
                <li key={e.id} className="flex items-center gap-4 p-4">
                  <div className={`flex size-9 items-center justify-center rounded-lg ${e.isStuck ? 'bg-amber-500/10' : 'bg-muted'}`}>
                    {e.isStuck ? <AlertTriangle className="size-4 text-amber-500" /> : <Clock className="size-4 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{e.deal.name}</p>
                      {e.currentState && (
                        <Badge variant="outline" className="text-[10px]" style={{ borderColor: e.currentState.stage.color }}>
                          {e.currentState.stage.name}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {e.blueprint.name} · {e.hoursInState}h in state
                      {e.currentState?.timeLimitHours && ` · limit: ${e.currentState.timeLimitHours}h`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">${(e.deal.amount / 1000).toFixed(0)}K</p>
                    {e.isStuck && <Badge variant="outline" className="border-amber-500/40 text-amber-600 text-[10px]">STUCK</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-center gap-3">
        <div className={`flex size-10 items-center justify-center rounded-lg bg-muted ${color ?? 'text-muted-foreground'}`}>
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
