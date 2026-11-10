'use client'

import * as React from 'react'
import { ShieldCheck, CheckCircle2, Circle, AlertTriangle, Activity, Database, Users, FileText, Clock, Rocket } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'

export function SystemAdminView() {
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold tracking-tight">System Administration</h1><p className="text-muted-foreground">Audit log, compliance, onboarding, system health</p></div>
      <Tabs defaultValue="health">
        <div className="w-full overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="w-full justify-start sm:w-auto sm:justify-center">
            <TabsTrigger value="health" className="shrink-0 px-3 min-h-9"><Activity className="mr-1.5 size-3.5" /> Health</TabsTrigger>
            <TabsTrigger value="audit" className="shrink-0 px-3 min-h-9"><ShieldCheck className="mr-1.5 size-3.5" /> Audit Log</TabsTrigger>
            <TabsTrigger value="compliance" className="shrink-0 px-3 min-h-9"><CheckCircle2 className="mr-1.5 size-3.5" /> Compliance</TabsTrigger>
            <TabsTrigger value="onboarding" className="shrink-0 px-3 min-h-9"><Rocket className="mr-1.5 size-3.5" /> Onboarding</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="health" className="mt-4"><HealthTab /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent>
        <TabsContent value="compliance" className="mt-4"><ComplianceTab /></TabsContent>
        <TabsContent value="onboarding" className="mt-4"><OnboardingTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function HealthTab() {
  const [health, setHealth] = React.useState<any>(null)
  React.useEffect(() => { fetch('/api/system-health', { cache: 'no-store' }).then(r => r.json()).then(setHealth).catch(() => setHealth({})) }, [])
  if (!health) return <Skeleton className="h-48 w-full" />
  const stats = [
    { label: 'Users', value: health.users, icon: Users },
    { label: 'Leads', value: health.leads, icon: Database },
    { label: 'Deals', value: health.deals, icon: Database },
    { label: 'Activities', value: health.activities, icon: Activity },
    { label: 'Files', value: health.files, icon: FileText },
    { label: 'Audit Events (24h)', value: health.auditEvents24h, icon: ShieldCheck },
  ]
  return (
    <div className="space-y-4">
      <Card><CardContent className="flex items-center gap-3 py-4">
        <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10"><CheckCircle2 className="size-5 text-emerald-500" /></div>
        <div><p className="font-medium">System Status: {health.status}</p><p className="text-xs text-muted-foreground">Uptime: {health.uptime}</p></div>
      </CardContent></Card>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(s => <Card key={s.label} className="py-3"><CardContent><div className="flex items-center gap-2"><s.icon className="size-4 text-muted-foreground" /><p className="text-xs text-muted-foreground">{s.label}</p></div><p className="mt-1 text-xl font-bold">{s.value}</p></CardContent></Card>)}
      </div>
    </div>
  )
}

function AuditTab() {
  const [entries, setEntries] = React.useState<any[] | null>(null)
  React.useEffect(() => { fetch('/api/audit-log?limit=50', { cache: 'no-store' }).then(r => r.json()).then(d => setEntries(d.entries ?? [])).catch(() => setEntries([])) }, [])
  return (
    <Card><CardHeader><CardTitle className="text-base">Audit Log</CardTitle><CardDescription>Immutable record of all changes</CardDescription></CardHeader>
      <CardContent className="p-0">
        {!entries ? <Skeleton className="h-48 w-full" /> : entries.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No audit events</p> :
          <div className="max-h-[60vh] overflow-y-auto"><table className="w-full text-sm">
            <thead className="sticky top-0 border-b bg-muted/60 text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2 text-left">Time</th><th className="px-3 py-2 text-left">Action</th><th className="px-3 py-2 text-left">Target</th><th className="px-3 py-2 text-left">IP</th></tr></thead>
            <tbody>{entries.map(e => <tr key={e.id} className="border-b hover:bg-muted/30"><td className="px-3 py-2 text-xs text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</td><td className="px-3 py-2 font-mono text-xs">{e.action}</td><td className="px-3 py-2 text-xs">{e.targetType}:{e.targetId?.slice(-8) ?? '—'}</td><td className="px-3 py-2 font-mono text-xs text-muted-foreground">{e.ip ?? '—'}</td></tr>)}</tbody>
          </table></div>}
      </CardContent></Card>
  )
}

function ComplianceTab() {
  const [frameworks, setFrameworks] = React.useState<Record<string, { total: number; met: number; items: any[] }> | null>(null)
  const load = React.useCallback(async () => { const res = await fetch('/api/compliance', { cache: 'no-store' }); const d = await res.json(); setFrameworks(d.frameworks ?? null) }, [])
  React.useEffect(() => { load() }, [load])
  const update = async (id: string, status: string) => { await fetch('/api/compliance', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }); toast.success('Updated'); load() }
  if (!frameworks) return <Skeleton className="h-48 w-full" />
  return (
    <div className="space-y-4">
      {Object.entries(frameworks).map(([name, fw]) => {
        const pct = fw.total > 0 ? (fw.met / fw.total) * 100 : 0
        return (
          <Card key={name}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{name}</CardTitle>
                <Badge variant="outline" className={pct === 100 ? 'border-emerald-500/40 text-emerald-600' : ''}>{fw.met}/{fw.total} met ({pct.toFixed(0)}%)</Badge>
              </div>
              <Progress value={pct} className="mt-2 h-2" />
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">{fw.items.map((item: any) => (
                <li key={item.id} className="flex items-center gap-2 p-3">
                  {item.status === 'met' ? <CheckCircle2 className="size-4 text-emerald-500" /> : item.status === 'not_applicable' ? <Circle className="size-4 text-muted-foreground" /> : <AlertTriangle className="size-4 text-amber-500" />}
                  <span className="flex-1 text-sm">{item.item}</span>
                  <select value={item.status} onChange={e => update(item.id, e.target.value)} className="h-7 rounded border bg-background text-xs">
                    <option value="pending">Pending</option><option value="met">Met</option><option value="not_applicable">N/A</option>
                  </select>
                </li>
              ))}</ul>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function OnboardingTab() {
  const [steps, setSteps] = React.useState<any[] | null>(null)
  const load = React.useCallback(async () => { const res = await fetch('/api/onboarding', { cache: 'no-store' }); const d = await res.json(); setSteps(d.steps ?? []) }, [])
  React.useEffect(() => { load() }, [load])
  const complete = async (step: string) => { await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step }) }); toast.success('Step completed'); load() }
  if (!steps) return <Skeleton className="h-48 w-full" />
  const completed = steps.filter(s => s.isCompleted).length
  const pct = (completed / steps.length) * 100
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between"><CardTitle className="text-base">Onboarding Progress</CardTitle><Badge variant="outline">{completed}/{steps.length} completed</Badge></div>
        <Progress value={pct} className="mt-2 h-2" />
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">{steps.map(s => (
          <li key={s.step} className="flex items-center gap-3 p-3">
            {s.isCompleted ? <CheckCircle2 className="size-5 text-emerald-500" /> : <Circle className="size-5 text-muted-foreground" />}
            <span className="flex-1 text-sm font-medium">{s.label}</span>
            {!s.isCompleted && <Button size="sm" variant="outline" onClick={() => complete(s.step)}>Mark Complete</Button>}
          </li>
        ))}</ul>
      </CardContent>
    </Card>
  )
}
