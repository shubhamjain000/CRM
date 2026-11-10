'use client'

import * as React from 'react'
import { CheckCircle2, XCircle, Clock, Plus, Trash2, RefreshCw, Shield, ArrowRight, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

interface Request {
  id: string; status: string; targetName: string; targetModule: string; submittedAt: string
  process: { name: string }
  actions: { action: string; comment: string | null; approverId: string; timestamp: string }[]
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  approved: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  rejected: 'border-destructive/40 text-destructive',
  recalled: 'border-muted-foreground/30 text-muted-foreground',
  escalated: 'border-destructive/40 text-destructive',
}

export function ApprovalCenterView() {
  const [tab, setTab] = React.useState('pending')
  const [requests, setRequests] = React.useState<Request[] | null>(null)
  const [comment, setComment] = React.useState('')

  const load = React.useCallback(async () => {
    setRequests(null)
    try {
      const filter = tab === 'pending' ? 'pending' : tab === 'my' ? 'my' : 'pending'
      const res = await fetch(`/api/approvals/requests?filter=${filter}`, { cache: 'no-store' })
      const data = await res.json()
      setRequests(data.requests ?? [])
    } catch {
      setRequests([])
    }
  }, [tab])

  React.useEffect(() => { load() }, [load])

  const approve = async (id: string) => {
    try {
      const res = await fetch('/api/approvals/requests/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id, comment }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      toast.success('Approved')
      setComment('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  const reject = async (id: string) => {
    try {
      const res = await fetch('/api/approvals/requests/reject', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id, comment }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      toast.success('Rejected')
      setComment('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  const recall = async (id: string) => {
    await fetch(`/api/approvals/requests/${id}`, { method: 'POST' })
    toast.success('Recalled')
    load()
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Approvals</h1>
        <p className="text-muted-foreground">Multi-step approval workflow center</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending"><Clock className="mr-1.5 size-3.5" /> Pending</TabsTrigger>
          <TabsTrigger value="my">My Requests</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Shield className="size-4" /> {tab === 'pending' ? 'Pending approvals' : tab === 'my' ? 'My requests' : 'All requests'}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!requests ? (
                <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
              ) : requests.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No requests</div>
              ) : (
                <ul className="divide-y">
                  {requests.map((r) => (
                    <li key={r.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{r.targetName}</p>
                            <Badge variant="outline" className={STATUS_BADGE[r.status] ?? ''}>{r.status}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{r.process.name} · {r.targetModule} · {new Date(r.submittedAt).toLocaleString()}</p>
                          {r.actions.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {r.actions.slice(0, 3).map((a, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  {a.action === 'approve' && <CheckCircle2 className="size-3 text-emerald-500" />}
                                  {a.action === 'reject' && <XCircle className="size-3 text-destructive" />}
                                  <span className="capitalize">{a.action}</span>
                                  {a.comment && <span>· "{a.comment}"</span>}
                                  <span>· {new Date(a.timestamp).toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {r.status === 'pending' && tab === 'pending' && (
                          <div className="flex items-center gap-2">
                            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" className="h-8 w-40 text-sm" />
                            <Button size="sm" onClick={() => approve(r.id)}><CheckCircle2 className="mr-1 size-3.5" /> Approve</Button>
                            <Button size="sm" variant="outline" className="text-destructive" onClick={() => reject(r.id)}><XCircle className="mr-1 size-3.5" /> Reject</Button>
                          </div>
                        )}
                        {r.status === 'pending' && tab === 'my' && (
                          <Button size="sm" variant="outline" onClick={() => recall(r.id)}>Recall</Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
