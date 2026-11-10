'use client'

import * as React from 'react'
import { Plus, Clock, Flag, CheckCircle2, Circle, Play, Square, Sparkles } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

interface Task {
  id: string; title: string; dueDate: string | null; priority: string
  status: string; description: string | null; timeSpent: number; tags: string
  checklist: string
}

const COLUMNS = [
  { key: 'not_started', label: 'To Do', color: 'border-t-muted-foreground' },
  { key: 'in_progress', label: 'In Progress', color: 'border-t-blue-500' },
  { key: 'completed', label: 'Done', color: 'border-t-emerald-500' },
  { key: 'deferred', label: 'Deferred', color: 'border-t-amber-500' },
]

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-destructive', high: 'text-amber-500', medium: 'text-blue-500', low: 'text-muted-foreground',
}

export function TasksView() {
  const [tasks, setTasks] = React.useState<Task[] | null>(null)
  const [quickAdd, setQuickAdd] = React.useState('')
  const [parsing, setParsing] = React.useState(false)
  const [formOpen, setFormOpen] = React.useState(false)
  const [form, setForm] = React.useState({ title: '', priority: 'medium', dueDate: '', description: '' })
  const [activeTimer, setActiveTimer] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/productivity/tasks?sort=-priority', { cache: 'no-store' })
      const data = await res.json()
      setTasks(data.tasks ?? [])
    } catch {
      setTasks([])
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const quickAddTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickAdd.trim()) return
    setParsing(true)
    try {
      const res = await fetch('/api/productivity/quick-add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: quickAdd }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Task created', { description: data.parsed?.dueDate ? `Due: ${new Date(data.parsed.dueDate).toLocaleString()}` : undefined })
      setQuickAdd('')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setParsing(false)
    }
  }

  const moveTask = async (taskId: string, status: string) => {
    setTasks((prev) => prev?.map((t) => t.id === taskId ? { ...t, status } : t) ?? null)
    try {
      await fetch(`/api/productivity/tasks/${taskId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
    } catch {
      toast.error('Update failed')
      load()
    }
  }

  const createTask = async () => {
    try {
      const res = await fetch('/api/productivity/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
          tags: JSON.stringify([]), checklist: JSON.stringify([]),
        }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Task created')
      setFormOpen(false)
      setForm({ title: '', priority: 'medium', dueDate: '', description: '' })
      load()
    } catch {
      toast.error('Failed')
    }
  }

  const toggleTimer = async (taskId: string) => {
    if (activeTimer === taskId) {
      // Stop
      setActiveTimer(null)
      await fetch(`/api/productivity/tasks/${taskId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timerStartedAt: null }),
      })
    } else {
      setActiveTimer(taskId)
      await fetch(`/api/productivity/tasks/${taskId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timerStartedAt: new Date().toISOString(), status: 'in_progress' }),
      })
    }
  }

  const grouped = COLUMNS.map((col) => ({
    ...col, tasks: tasks?.filter((t) => t.status === col.key) ?? [],
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">{tasks?.length ?? 0} tasks</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setFormOpen(true)}><Plus className="mr-1.5 size-4" /> New task</Button>
        </div>
      </div>

      {/* Quick add with natural language */}
      <Card className="py-3">
        <CardContent className="flex items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-primary" />
          <form onSubmit={quickAddTask} className="flex flex-1 items-center gap-2">
            <Input
              value={quickAdd}
              onChange={(e) => setQuickAdd(e.target.value)}
              placeholder='Try: "Call John tomorrow 3pm #urgent"'
              className="border-0 shadow-none focus-visible:ring-0"
            />
            <Button type="submit" size="sm" disabled={parsing || !quickAdd.trim()}>
              {parsing ? 'Parsing…' : 'Add'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Kanban board */}
      {!tasks ? (
        <div className="grid gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-4">
          {grouped.map((col) => (
            <div key={col.key} className="space-y-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (activeTimer) return; /* no-op */ }}
            >
              <div className={`rounded-lg border border-t-4 ${col.color} bg-muted/40 px-3 py-2`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{col.label}</span>
                  <span className="text-xs text-muted-foreground">{col.tasks.length}</span>
                </div>
              </div>
              <div className="space-y-2">
                {col.tasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('taskId', task.id)}
                    onDragEnd={(e) => {
                      // Read dropped column — handled by onDrop on columns
                    }}
                    className="cursor-grab rounded-lg border bg-card p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing"
                  >
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => moveTask(task.id, task.status === 'completed' ? 'not_started' : 'completed')}
                        className="mt-0.5 shrink-0"
                      >
                        {task.status === 'completed'
                          ? <CheckCircle2 className="size-4 text-emerald-500" />
                          : <Circle className="size-4 text-muted-foreground" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>{task.title}</p>
                        {task.dueDate && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="size-3" />
                            {new Date(task.dueDate).toLocaleDateString()}
                            {new Date(task.dueDate) < new Date() && task.status !== 'completed' && (
                              <span className="text-destructive">· overdue</span>
                            )}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center gap-2">
                          <Flag className={`size-3 ${PRIORITY_COLORS[task.priority] ?? ''}`} />
                          <span className={`text-xs capitalize ${PRIORITY_COLORS[task.priority] ?? ''}`}>{task.priority}</span>
                          {activeTimer === task.id && <Badge variant="outline" className="border-blue-500/40 text-blue-600 text-[10px]">tracking</Badge>}
                        </div>
                      </div>
                      <button onClick={() => toggleTimer(task.id)} className="shrink-0 text-muted-foreground hover:text-foreground">
                        {activeTimer === task.id ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
                {/* Drop zone */}
                <div
                  className="rounded-lg border border-dashed p-2 text-center text-xs text-muted-foreground"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const taskId = e.dataTransfer.getData('taskId')
                    if (taskId) moveTask(taskId, col.key)
                  }}
                >
                  Drop here
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New task dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>Create a task with details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input type="datetime-local" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={createTask} disabled={!form.title}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
