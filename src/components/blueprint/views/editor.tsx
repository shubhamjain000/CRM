'use client'

import * as React from 'react'
import { Plus, Upload, Trash2, GitBranch, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

interface Stage { id: string; name: string; order: number; color: string }
interface BpState { id: string; stageId: string; stateType: string; timeLimitHours: number | null; stage: Stage }
interface BpTransition {
  id: string; fromStateId: string; toStateId: string; requireApproval: boolean
  allowedRoles: string; requireFields: string
  fromState: { stage: Stage }; toState: { stage: Stage }
}
interface Blueprint {
  id: string; name: string; isActive: boolean; isPublished: boolean; description: string | null
  pipeline: { name: string; stages: Stage[] }
  states: BpState[]; transitions: BpTransition[]
  _count?: { executions: number }
}

export function BlueprintEditorView() {
  const [blueprints, setBlueprints] = React.useState<Blueprint[] | null>(null)
  const [selected, setSelected] = React.useState<Blueprint | null>(null)
  const [newOpen, setNewOpen] = React.useState(false)
  const [newBp, setNewBp] = React.useState({ name: '', pipelineId: '' })
  const [pipelines, setPipelines] = React.useState<{ id: string; name: string }[]>([])
  const [transOpen, setTransOpen] = React.useState(false)
  const [newTrans, setNewTrans] = React.useState({ fromStateId: '', toStateId: '', requireApproval: false, requireFields: '', timeLimitHours: 0 })

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/blueprints', { cache: 'no-store' })
      const data = await res.json()
      setBlueprints(data.blueprints ?? [])
      if (data.blueprints?.[0] && !selected) {
        // Load full detail
        loadDetail(data.blueprints[0].id)
      }
    } catch {
      setBlueprints([])
    }
  }, [selected])

  const loadDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/blueprints/${id}`, { cache: 'no-store' })
      const data = await res.json()
      setSelected(data.blueprint)
    } catch {}
  }

  const loadPipelines = React.useCallback(async () => {
    const res = await fetch('/api/pipelines', { cache: 'no-store' })
    const data = await res.json()
    setPipelines((data.pipelines ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
  }, [])

  React.useEffect(() => { load(); loadPipelines() }, [load, loadPipelines])

  const create = async () => {
    try {
      const res = await fetch('/api/blueprints', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBp),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Blueprint created with auto-generated states')
      setNewOpen(false); setNewBp({ name: '', pipelineId: '' })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  const publish = async () => {
    if (!selected) return
    await fetch(`/api/blueprints/${selected.id}/publish`, { method: 'POST' })
    toast.success('Blueprint published & activated')
    loadDetail(selected.id)
    load()
  }

  const addTransition = async () => {
    if (!selected || !newTrans.fromStateId || !newTrans.toStateId) return
    try {
      const res = await fetch(`/api/blueprints/${selected.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_transition',
          fromStateId: newTrans.fromStateId,
          toStateId: newTrans.toStateId,
          requireApproval: newTrans.requireApproval,
          requireFields: newTrans.requireFields ? newTrans.requireFields.split(',').map((s) => s.trim()) : [],
        }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Transition added')
      setTransOpen(false)
      setNewTrans({ fromStateId: '', toStateId: '', requireApproval: false, requireFields: '', timeLimitHours: 0 })
      loadDetail(selected.id)
    } catch {
      toast.error('Failed')
    }
  }

  const deleteTransition = async (transId: string) => {
    if (!selected) return
    await fetch(`/api/blueprints/${selected.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_transition', transitionId: transId }),
    })
    toast.success('Transition removed')
    loadDetail(selected.id)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Blueprints</h1>
          <p className="text-muted-foreground">Enforce sales process compliance</p>
        </div>
        <Button onClick={() => setNewOpen(true)}><Plus className="mr-1.5 size-4" /> New blueprint</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Blueprint list */}
        <div className="space-y-2">
          {!blueprints ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : blueprints.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No blueprints yet</CardContent></Card>
          ) : blueprints.map((bp) => (
            <button
              key={bp.id}
              onClick={() => loadDetail(bp.id)}
              className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/30 ${selected?.id === bp.id ? 'border-primary bg-muted/30' : ''}`}
            >
              <div className="flex items-center gap-2">
                <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate font-medium">{bp.name}</span>
                {bp.isActive && <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 text-[10px]">active</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{bp.pipeline?.name ?? '—'} · {bp._count?.executions ?? 0} deals</p>
            </button>
          ))}
        </div>

        {/* Editor: visual flowchart */}
        {selected ? (
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{selected.name}</CardTitle>
                  <CardDescription>{selected.pipeline?.name} · {selected.states.length} states · {selected.transitions.length} transitions</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setTransOpen(true)}><Plus className="mr-1 size-4" /> Add transition</Button>
                  {!selected.isActive && <Button size="sm" onClick={publish}><Upload className="mr-1 size-4" /> Publish</Button>}
                </div>
              </CardHeader>
            </Card>

            {/* Flowchart visualization */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Flowchart</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-2 ribbon pb-4">
                  {selected.states.map((state, i) => {
                    const outgoing = selected.transitions.filter((t) => t.fromStateId === state.id)
                    return (
                      <div key={state.id} className="flex items-center gap-2">
                        <div
                          className="flex min-w-[140px] flex-col items-center gap-2 rounded-lg border-2 p-3"
                          style={{ borderColor: state.stage.color }}
                        >
                          <div className="size-8 rounded-full" style={{ backgroundColor: state.stage.color }} />
                          <span className="text-sm font-medium">{state.stage.name}</span>
                          <div className="flex gap-1">
                            {state.stateType === 'terminal' && <Badge variant="outline" className="text-[10px]">terminal</Badge>}
                            {state.timeLimitHours && <Badge variant="outline" className="text-[10px]"><Clock className="mr-0.5 size-2.5" />{state.timeLimitHours}h</Badge>}
                          </div>
                          {outgoing.length > 0 && (
                            <div className="mt-1 w-full space-y-1 border-t pt-1">
                              {outgoing.map((t) => (
                                <div key={t.id} className="flex items-center gap-1 text-xs">
                                  <span className="text-muted-foreground">→</span>
                                  <span>{t.toState.stage.name}</span>
                                  {t.requireApproval && <span className="text-amber-500">⚠</span>}
                                  <button onClick={() => deleteTransition(t.id)} className="ml-auto text-destructive"><Trash2 className="size-3" /></button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {i < selected.states.length - 1 && (
                          <div className="flex flex-col items-center text-muted-foreground">
                            <div className="h-px w-6 bg-border" />
                            <span className="text-xs">→</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">Select a blueprint to edit</CardContent></Card>
        )}
      </div>

      {/* New blueprint dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New blueprint</DialogTitle>
            <DialogDescription>Auto-creates a state for each stage in the pipeline.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={newBp.name} onChange={(e) => setNewBp({ ...newBp, name: e.target.value })} placeholder="Standard Sales Process" />
            </div>
            <div className="space-y-1.5">
              <Label>Pipeline</Label>
              <Select value={newBp.pipelineId} onValueChange={(v) => setNewBp({ ...newBp, pipelineId: v })}>
                <SelectTrigger><SelectValue placeholder="Select pipeline" /></SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={!newBp.name || !newBp.pipelineId}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add transition dialog */}
      <Dialog open={transOpen} onOpenChange={setTransOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add transition</DialogTitle>
            <DialogDescription>Define a valid state transition with rules.</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>From state</Label>
                  <Select value={newTrans.fromStateId} onValueChange={(v) => setNewTrans({ ...newTrans, fromStateId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {selected.states.map((s) => <SelectItem key={s.id} value={s.id}>{s.stage.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>To state</Label>
                  <Select value={newTrans.toStateId} onValueChange={(v) => setNewTrans({ ...newTrans, toStateId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {selected.states.map((s) => <SelectItem key={s.id} value={s.id}>{s.stage.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Required fields (comma-separated)</Label>
                <Input value={newTrans.requireFields} onChange={(e) => setNewTrans({ ...newTrans, requireFields: e.target.value })} placeholder="amount, closeDate" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={newTrans.requireApproval} onChange={(e) => setNewTrans({ ...newTrans, requireApproval: e.target.checked })} />
                Requires approval
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransOpen(false)}>Cancel</Button>
            <Button onClick={addTransition} disabled={!newTrans.fromStateId || !newTrans.toStateId}>Add transition</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
