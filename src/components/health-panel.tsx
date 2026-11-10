'use client'

import * as React from 'react'
import { Activity, CheckCircle2, Cpu, Clock, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface HealthDep {
  id: string
  name: string
  status: string
  port: string
  latencyMs?: number
}

interface HealthResponse {
  status: string
  service: string
  version: string
  phase: string
  environment: string
  timestamp: string
  uptime: { ms: number; seconds: number; human: string }
  runtime: { node: string; platform: string; arch: string }
  dependencies: { total: number; live: number; configured: number; down?: number; items: HealthDep[] }
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: HealthResponse }

export function HealthPanel() {
  const [state, setState] = React.useState<State>({ kind: 'loading' })

  const load = React.useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as HealthResponse
      setState({ kind: 'ready', data })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }, [])

  React.useEffect(() => {
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="size-5 text-emerald-500" />
            <CardTitle>Live Health</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {state.kind === 'ready' && (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500" />
                Operational
              </Badge>
            )}
            {state.kind === 'error' && (
              <Badge variant="destructive">Unreachable</Badge>
            )}
            {state.kind === 'loading' && (
              <Badge variant="secondary">Polling…</Badge>
            )}
            <Button variant="outline" size="icon" className="size-8" onClick={load} aria-label="Refresh health">
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
        <CardDescription>
          Polled from <code className="font-mono text-xs">/api/health</code> every 15s.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {state.kind === 'loading' && (
          <div className="space-y-3">
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
          </div>
        )}

        {state.kind === 'error' && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            Health endpoint unreachable: {state.message}
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Service" value={state.data.service} />
              <Metric label="Version" value={`v${state.data.version}`} />
              <Metric label="Phase" value={state.data.phase} />
              <Metric label="Env" value={state.data.environment} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat icon={<Clock className="size-4" />} label="Uptime" value={state.data.uptime.human} />
              <Stat icon={<Cpu className="size-4" />} label="Runtime" value={state.data.runtime.node} />
              <Stat
                icon={<CheckCircle2 className="size-4" />}
                label="Dependencies"
                value={`${state.data.dependencies.live} live · ${state.data.dependencies.configured} configured${state.data.dependencies.down ? ` · ${state.data.dependencies.down} down` : ''}`}
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Dependency manifest
              </p>
              <div className="max-h-56 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Service</th>
                      <th className="px-3 py-2 font-medium">Port</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.dependencies.items.map((d) => (
                      <tr key={d.id} className="border-t">
                        <td className="px-3 py-2 font-medium">{d.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{d.port}</td>
                        <td className="px-3 py-2">
                          {d.status === 'up' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                              <span className="size-1.5 rounded-full bg-emerald-500" /> up
                            </span>
                          ) : d.status === 'down' ? (
                            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                              <span className="size-1.5 rounded-full bg-red-500" /> down
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                              <span className="size-1.5 rounded-full bg-amber-500" /> configured
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-medium">{value}</p>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-sm font-medium">{value}</p>
      </div>
    </div>
  )
}
