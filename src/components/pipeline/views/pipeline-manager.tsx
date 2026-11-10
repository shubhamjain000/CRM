'use client'

import * as React from 'react'
import { Plus, GripVertical, Trash2, Settings2, TrendingUp } from 'lucide-react'
import { fmtINRCompact } from '@/lib/money'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

interface Stage {
  id: string; name: string; probability: number; order: number
  isWonStage: boolean; isLostStage: boolean; isLocked: boolean
  businessDaysLimit: number | null; color: string; forecastCategory: string
}

interface Pipeline {
  id: string; name: string; isDefault: boolean; isActive: boolean
  stages: Stage[]; _count?: { deals: number }
}

const FORECAST_CATEGORIES = [
  { value: 'pipeline', label: 'Pipeline', color: 'text-blue-500' },
  { value: 'best_case', label: 'Best Case', color: 'text-purple-500' },
  { value: 'commit', label: 'Commit', color: 'text-emerald-500' },
  { value: 'closed', label: 'Closed', color: 'text-amber-500' },
  { value: 'omitted', label: 'Omitted', color: 'text-muted-foreground' },
]

const STAGE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280']

export function PipelineManagerView() {
  const [pipelines, setPipelines] = React.useState<Pipeline[] | null>(null)
  const [selectedPipeline, setSelectedPipeline] = React.useState<Pipeline | null>(null)
  const [newPipelineOpen, setNewPipelineOpen] = React.useState(false)
  const [newPipelineName, setNewPipelineName] = React.useState('')
  const [newStageOpen, setNewStageOpen] = React.useState(false)
  const [newStage, setNewStage] = React.useState({ name: '', probability: 0, isWonStage: false, isLostStage: false, businessDaysLimit: 0, color: '#3b82f6', forecastCategory: 'pipeline' })
  const [editingStage, setEditingStage] = React.useState<Stage | null>(null)
  const [dragIndex, setDragIndex] = React.useState<number | null>(null)
  const [metrics, setMetrics] = React.useState<{ totalDeals: number; totalAmount: number; totalWeighted: number; winRate: number } | null>(null)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/pipelines', { cache: 'no-store' })
      const data = await res.json()
      setPipelines(data.pipelines ?? [])
      if (data.pipelines?.[0] && !selectedPipeline) setSelectedPipeline(data.pipelines[0])
    } catch {
      setPipelines([])
    }
  }, [selectedPipeline])

  React.useEffect(() => { load() }, [load])

  // Load metrics when pipeline changes
  React.useEffect(() => {
    if (!selectedPipeline) return
    fetch(`/api/pipelines/${selectedPipeline.id}/metrics`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setMetrics(d))
      .catch(() => setMetrics(null))
  }, [selectedPipeline])

  const createPipeline = async () => {
    try {
      const res = await fetch('/api/pipelines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPipelineName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Pipeline created')
      setNewPipelineOpen(false); setNewPipelineName('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  const createStage = async () => {
    if (!selectedPipeline) return
    try {
      const res = await fetch(`/api/pipelines/${selectedPipeline.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newStage.name,
          probability: newStage.probability,
          isWonStage: newStage.isWonStage,
          isLostStage: newStage.isLostStage,
          businessDaysLimit: newStage.businessDaysLimit || null,
          color: newStage.color,
          forecastCategory: newStage.forecastCategory,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Stage added')
      setNewStageOpen(false)
      setNewStage({ name: '', probability: 0, isWonStage: false, isLostStage: false, businessDaysLimit: 0, color: '#3b82f6', forecastCategory: 'pipeline' })
      load()
    } catch {
      toast.error('Failed')
    }
  }

  const updateStage = async (stage: Stage, data: Partial<Stage>) => {
    try {
      await fetch(`/api/pipelines/${selectedPipeline!.id}/stages/${stage.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      toast.success('Stage updated')
      load()
    } catch {
      toast.error('Update failed')
    }
  }

  const reorder = async (newOrder: Stage[]) => {
    if (!selectedPipeline) return
    // Optimistic
    setSelectedPipeline({ ...selectedPipeline, stages: newOrder })
    try {
      await fetch(`/api/pipelines/${selectedPipeline.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageIds: newOrder.map((s) => s.id) }),
      })
    } catch {
      toast.error('Reorder failed')
      load()
    }
  }

  const onDrop = (dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex || !selectedPipeline) return
    const stages = [...selectedPipeline.stages]
    const [dragged] = stages.splice(dragIndex, 1)
    stages.splice(dropIndex, 0, dragged)
    reorder(stages)
    setDragIndex(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipelines</h1>
          <p className="text-muted-foreground">{pipelines?.length ?? 0} pipelines</p>
        </div>
        <Button onClick={() => setNewPipelineOpen(true)}><Plus className="mr-1.5 size-4" /> New pipeline</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Pipeline list */}
        <div className="space-y-2">
          {!pipelines ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : pipelines.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPipeline(p)}
              className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/30 ${selectedPipeline?.id === p.id ? 'border-primary bg-muted/30' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate font-medium">{p.name}</span>
                {p.isDefault && <Badge variant="secondary" className="text-[10px]">default</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{p.stages.length} stages · {p._count?.deals ?? 0} deals</p>
            </button>
          ))}
        </div>

        {/* Stage editor */}
        {selectedPipeline && (
          <div className="space-y-4">
            {/* Metrics summary */}
            {metrics && (
              <div className="grid grid-cols-4 gap-3">
                <Card className="py-3"><CardContent className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Deals</p><p className="text-xl font-semibold">{metrics.totalDeals}</p></div></CardContent></Card>
                <Card className="py-3"><CardContent><p className="text-xs text-muted-foreground">Total value</p><p className="text-xl font-semibold">{fmtINRCompact(metrics.totalAmount)}</p></CardContent></Card>
                <Card className="py-3"><CardContent><p className="text-xs text-muted-foreground">Weighted</p><p className="text-xl font-semibold">{fmtINRCompact(metrics.totalWeighted)}</p></CardContent></Card>
                <Card className="py-3"><CardContent><p className="text-xs text-muted-foreground">Win rate</p><p className="text-xl font-semibold">{metrics.winRate.toFixed(0)}%</p></CardContent></Card>
              </div>
            )}

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{selectedPipeline.name} — Stages</CardTitle>
                  <CardDescription>Drag to reorder. Click a stage to edit.</CardDescription>
                </div>
                <Button size="sm" onClick={() => setNewStageOpen(true)}><Plus className="mr-1 size-4" /> Add stage</Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="space-y-1 p-3">
                  {selectedPipeline.stages.map((stage, i) => (
                    <div
                      key={stage.id}
                      draggable
                      onDragStart={() => setDragIndex(i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => onDrop(i)}
                      onClick={() => setEditingStage(stage)}
                      className="flex items-center gap-3 rounded-lg border p-3 transition hover:bg-muted/30 cursor-pointer"
                    >
                      <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
                      <div className="size-3 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{stage.name}</span>
                          {stage.isWonStage && <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 text-[10px]">WON</Badge>}
                          {stage.isLostStage && <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">LOST</Badge>}
                          {stage.isLocked && <Badge variant="secondary" className="text-[10px]">locked</Badge>}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{stage.probability}%</span>
                          {stage.businessDaysLimit && <span>· {stage.businessDaysLimit}d limit</span>}
                          <span className="capitalize">· {stage.forecastCategory.replace('_', ' ')}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* New pipeline dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New pipeline</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={newPipelineName} onChange={(e) => setNewPipelineName(e.target.value)} placeholder="Sales Pipeline" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPipelineOpen(false)}>Cancel</Button>
            <Button onClick={createPipeline} disabled={!newPipelineName}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New stage dialog */}
      <Dialog open={newStageOpen} onOpenChange={setNewStageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New stage</DialogTitle>
            <DialogDescription>Add a stage to {selectedPipeline?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={newStage.name} onChange={(e) => setNewStage({ ...newStage, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Probability %</Label>
                <Input type="number" value={newStage.probability} onChange={(e) => setNewStage({ ...newStage, probability: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Business days limit</Label>
                <Input type="number" value={newStage.businessDaysLimit} onChange={(e) => setNewStage({ ...newStage, businessDaysLimit: Number(e.target.value) })} placeholder="0 = none" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Color</Label>
                <div className="flex gap-1.5">
                  {STAGE_COLORS.map((c) => (
                    <button key={c} onClick={() => setNewStage({ ...newStage, color: c })}
                      className={`size-7 rounded-full border-2 ${newStage.color === c ? 'border-foreground' : 'border-transparent'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Forecast category</Label>
                <Select value={newStage.forecastCategory} onValueChange={(v) => setNewStage({ ...newStage, forecastCategory: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORECAST_CATEGORIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={newStage.isWonStage} onChange={(e) => setNewStage({ ...newStage, isWonStage: e.target.checked, isLostStage: false })} />
                Won stage
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={newStage.isLostStage} onChange={(e) => setNewStage({ ...newStage, isLostStage: e.target.checked, isWonStage: false })} />
                Lost stage
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewStageOpen(false)}>Cancel</Button>
            <Button onClick={createStage} disabled={!newStage.name}>Add stage</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit stage dialog */}
      <Dialog open={!!editingStage} onOpenChange={(v) => !v && setEditingStage(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit stage</DialogTitle></DialogHeader>
          {editingStage && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input defaultValue={editingStage.name} onChange={(e) => setEditingStage({ ...editingStage, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Probability %</Label>
                  <Input type="number" defaultValue={editingStage.probability} onChange={(e) => setEditingStage({ ...editingStage, probability: Number(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Business days limit</Label>
                  <Input type="number" defaultValue={editingStage.businessDaysLimit ?? 0} onChange={(e) => setEditingStage({ ...editingStage, businessDaysLimit: Number(e.target.value) || null })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Color</Label>
                  <div className="flex gap-1.5">
                    {STAGE_COLORS.map((c) => (
                      <button key={c} onClick={() => setEditingStage({ ...editingStage, color: c })}
                        className={`size-7 rounded-full border-2 ${editingStage.color === c ? 'border-foreground' : 'border-transparent'}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Forecast</Label>
                  <Select value={editingStage.forecastCategory} onValueChange={(v) => setEditingStage({ ...editingStage, forecastCategory: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FORECAST_CATEGORIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editingStage.isWonStage} onChange={(e) => setEditingStage({ ...editingStage, isWonStage: e.target.checked, isLostStage: false })} />
                  Won stage
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editingStage.isLostStage} onChange={(e) => setEditingStage({ ...editingStage, isLostStage: e.target.checked, isWonStage: false })} />
                  Lost stage
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editingStage.isLocked} onChange={(e) => setEditingStage({ ...editingStage, isLocked: e.target.checked })} />
                  Locked
                </label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStage(null)}>Cancel</Button>
            <Button onClick={() => { if (editingStage) updateStage(editingStage, editingStage); setEditingStage(null) }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
