'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
  GripVertical,
  HandCoins,
  IndianRupee,
  ListTodo,
  Mail,
  Pencil,
  Phone,
  Plus,
  Target,
  Trophy,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAuth } from '@/store/auth'

interface Stats {
  total: number; overdue: number; completed: number; inProgress: number; notStarted: number
}
interface UpcomingEvent { id: string; title: string; start: string; end: string }
interface TodayTask { id: string; title: string; dueDate: string | null; priority: string; status: string }

/* ------------------------------------------------------------------ */
/* Dashboard widgets                                                   */
/* ------------------------------------------------------------------ */

interface LeaderboardEntry { rep: string; revenue: number; deals: number }
interface WidgetRow {
  id: string; widgetType: string; title: string; order: number
  size: string; colorTheme: string; value: number; format: string
  rows?: LeaderboardEntry[]
}
interface DashboardMeta { id: string; name: string; refreshInterval: number }

const METRIC_META: Record<string, { label: string; icon: LucideIcon }> = {
  revenue: { label: 'Total Revenue', icon: IndianRupee },
  open_deals: { label: 'Open Deals', icon: HandCoins },
  win_rate: { label: 'Win Rate', icon: Target },
  total_leads: { label: 'Total Leads', icon: UserPlus },
  my_tasks: { label: 'My Tasks', icon: ListTodo },
  overdue_tasks: { label: 'Overdue Tasks', icon: AlertTriangle },
  upcoming_events: { label: 'Upcoming Events', icon: Calendar },
  calls: { label: 'Calls', icon: Phone },
  emails: { label: 'Emails', icon: Mail },
  won_deals: { label: 'Won Deals', icon: Trophy },
  pipeline: { label: 'Pipeline', icon: Filter },
  leaderboard: { label: 'Leaderboard', icon: Users },
}

const COLOR_CHIP: Record<string, string> = {
  default: 'bg-muted text-foreground',
  emerald: 'bg-emerald-500/10 text-emerald-500',
  amber: 'bg-amber-500/10 text-amber-500',
  rose: 'bg-rose-500/10 text-rose-500',
  sky: 'bg-sky-500/10 text-sky-500',
}

const COLOR_DOT: Record<string, string> = {
  default: 'bg-muted-foreground/40',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  sky: 'bg-sky-500',
}

const COLOR_CYCLE = ['default', 'emerald', 'amber', 'rose', 'sky']

const SPAN: Record<string, string> = {
  sm: 'lg:col-span-1',
  md: 'lg:col-span-2',
  lg: 'lg:col-span-4',
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

function formatValue(format: string, value: number): string {
  if (format === 'currency') return inr.format(value)
  if (format === 'percent') return `${value.toFixed(1)}%`
  return new Intl.NumberFormat('en-IN').format(value)
}

function nextSize(size: string): string {
  return size === 'sm' ? 'md' : size === 'md' ? 'lg' : 'sm'
}

function nextColor(theme: string): string {
  const idx = COLOR_CYCLE.indexOf(theme)
  return COLOR_CYCLE[(idx + 1 + COLOR_CYCLE.length) % COLOR_CYCLE.length] ?? 'default'
}

export function OverviewView() {
  const t = useTranslations()
  const { user, organizations, currentOrgId } = useAuth()
  const [stats, setStats] = React.useState<Stats | null>(null)
  const [events, setEvents] = React.useState<UpcomingEvent[]>([])
  const [tasks, setTasks] = React.useState<TodayTask[]>([])

  // Dashboard widget grid state
  const [widgets, setWidgets] = React.useState<WidgetRow[] | null>(null)
  const [dashboard, setDashboard] = React.useState<DashboardMeta | null>(null)
  const [edit, setEdit] = React.useState(false)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [adding, setAdding] = React.useState(false)

  const loadDashboard = React.useCallback(async () => {
    try {
      const res = await fetch('/api/dashboards', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { dashboard?: DashboardMeta; widgets?: WidgetRow[] }
      setDashboard(data.dashboard ?? null)
      setWidgets(data.widgets ?? [])
    } catch {
      toast.error('Failed to load dashboard widgets')
      setWidgets([])
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/productivity/stats', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/productivity/today', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    ]).then(([s, td]) => {
      if (cancelled) return
      setStats(s.stats ?? null)
      setEvents(s.upcomingEvents ?? [])
      setTasks(td.tasks ?? [])
    })
    return () => { cancelled = true }
  }, [currentOrgId])

  React.useEffect(() => {
    setWidgets(null)
    void loadDashboard()
  }, [loadDashboard, currentOrgId])

  /* ---------------- widget mutations (optimistic + revert) ---------------- */

  function moveWidget(fromId: string, toId: string) {
    if (!widgets) return
    const from = widgets.findIndex((w) => w.id === fromId)
    const to = widgets.findIndex((w) => w.id === toId)
    if (from === -1 || to === -1 || from === to) return
    const prev = widgets
    const next = [...prev]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setWidgets(next)
    void persistOrder(next, prev)
  }

  function moveWidgetByIndex(index: number, dir: -1 | 1) {
    if (!widgets) return
    const to = index + dir
    if (to < 0 || to >= widgets.length) return
    moveWidget(widgets[index].id, widgets[to].id)
  }

  async function persistOrder(next: WidgetRow[], prev: WidgetRow[]) {
    try {
      const res = await fetch('/api/dashboards/widgets/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next.map((w) => w.id) }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      toast.error('Failed to save widget order')
      setWidgets(prev)
    }
  }

  async function patchWidget(id: string, patch: Partial<Pick<WidgetRow, 'size' | 'colorTheme' | 'title'>>) {
    if (!widgets) return
    const prev = widgets
    setWidgets(prev.map((w) => (w.id === id ? { ...w, ...patch } : w)))
    try {
      const res = await fetch(`/api/dashboards/widgets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      toast.error('Failed to update widget')
      setWidgets(prev)
    }
  }

  async function removeWidget(id: string) {
    if (!widgets) return
    const prev = widgets
    setWidgets(prev.filter((w) => w.id !== id))
    try {
      const res = await fetch(`/api/dashboards/widgets/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      toast.error('Failed to remove widget')
      setWidgets(prev)
    }
  }

  async function addWidget(widgetType: string) {
    setAdding(true)
    try {
      const res = await fetch('/api/dashboards/widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgetType }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await loadDashboard()
    } catch {
      toast.error('Failed to add widget')
    } finally {
      setAdding(false)
    }
  }

  const org = organizations.find((o) => o.isCurrent) ?? organizations[0]
  const overdueTasks = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'completed')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t('dashboard.welcome', { name: user?.name ?? '' })}
        </h1>
        <p className="text-muted-foreground">{org?.name} · {org?.role}</p>
      </div>

      {/* Configurable widget grid */}
      <section aria-label="Dashboard widgets" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Metrics{dashboard ? ` · refreshes every ${dashboard.refreshInterval}s` : ''}
          </h2>
          <div className="flex items-center gap-2">
            {edit && <AddWidgetMenu disabled={adding} onAdd={addWidget} />}
            <Button
              variant={edit ? 'default' : 'outline'}
              size="sm"
              aria-pressed={edit}
              onClick={() => setEdit((v) => !v)}
            >
              {edit ? <Check className="size-4" /> : <Pencil className="size-4" />}
              {edit ? 'Done' : 'Edit layout'}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {widgets === null ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-xl" />
            ))
          ) : widgets.length === 0 ? (
            <Card className="border-dashed sm:col-span-2 lg:col-span-4">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No widgets yet — enter edit mode and add metrics like revenue, pipeline or your leaderboard.
              </CardContent>
            </Card>
          ) : (
            widgets.map((w, i) => (
              <WidgetCard
                key={w.id}
                widget={w}
                index={i}
                total={widgets.length}
                edit={edit}
                dragging={dragId}
                onDragStart={setDragId}
                onDragEnd={() => setDragId(null)}
                onDropOn={moveWidget}
                onMove={moveWidgetByIndex}
                onPatch={patchWidget}
                onRemove={removeWidget}
              />
            ))
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Today's tasks */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Today's tasks</CardTitle>
            <CardDescription>{tasks.length} due today · {overdueTasks.length} overdue</CardDescription>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No tasks due today. You're all caught up!</p>
            ) : (
              <ul className="space-y-2">
                {tasks.slice(0, 6).map((task) => {
                  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed'
                  return (
                    <li key={task.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                      <button
                        onClick={async () => {
                          await fetch(`/api/productivity/tasks/${task.id}`, {
                            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'completed' }),
                          })
                          fetch('/api/productivity/today', { cache: 'no-store' }).then((r) => r.json()).then((d) => setTasks(d.tasks ?? []))
                          fetch('/api/productivity/stats', { cache: 'no-store' }).then((r) => r.json()).then((d) => setStats(d.stats))
                        }}
                        className="shrink-0"
                      >
                        {task.status === 'completed'
                          ? <CheckCircle2 className="size-4 text-emerald-500" />
                          : <div className={`size-4 rounded-full border-2 ${isOverdue ? 'border-destructive' : 'border-muted-foreground'}`} />}
                      </button>
                      <span className={`flex-1 text-sm ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>
                        {task.title}
                      </span>
                      {isOverdue && <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">overdue</Badge>}
                      <span className="text-xs text-muted-foreground capitalize">{task.priority}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Donut: tasks by status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks by status</CardTitle>
          </CardHeader>
          <CardContent>
            {stats ? <DonutChart stats={stats} /> : <Skeleton className="h-40 w-full" />}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming meetings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="size-4" /> Upcoming meetings (7 days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No upcoming meetings</p>
          ) : (
            <ul className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Calendar className="size-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{e.title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(e.start).toLocaleString()}</p>
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

/* ------------------------------------------------------------------ */
/* Widget card                                                         */
/* ------------------------------------------------------------------ */

interface WidgetCardProps {
  widget: WidgetRow
  index: number
  total: number
  edit: boolean
  dragging: string | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDropOn: (fromId: string, targetId: string) => void
  onMove: (index: number, dir: -1 | 1) => void
  onPatch: (id: string, patch: Partial<Pick<WidgetRow, 'size' | 'colorTheme' | 'title'>>) => void
  onRemove: (id: string) => void
}

function WidgetCard({ widget, index, total, edit, dragging, onDragStart, onDragEnd, onDropOn, onMove, onPatch, onRemove }: WidgetCardProps) {
  const meta = METRIC_META[widget.widgetType] ?? { label: widget.title, icon: ListTodo }
  const Icon = meta.icon
  const chip = COLOR_CHIP[widget.colorTheme] ?? COLOR_CHIP.default

  return (
    <Card
      draggable={edit}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        try { e.dataTransfer.setData('text/plain', widget.id) } catch { /* older engines */ }
        onDragStart(widget.id)
      }}
      onDragOver={(e) => { if (dragging && dragging !== widget.id) e.preventDefault() }}
      onDrop={(e) => { e.preventDefault(); if (dragging) onDropOn(dragging, widget.id) }}
      onDragEnd={onDragEnd}
      className={cn(
        'gap-0 py-0',
        SPAN[widget.size] ?? SPAN.md,
        edit && 'cursor-grab select-none active:cursor-grabbing',
        dragging === widget.id && 'opacity-50 ring-2 ring-ring/60',
      )}
      aria-roledescription="widget"
    >
      {edit && (
        <div
          className="flex items-center justify-between gap-1 border-b bg-muted/40 px-2 py-1"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
          <div className="flex items-center">
            <Button
              variant="ghost" size="icon" className="size-8"
              aria-label={`Move ${widget.title} up`}
              disabled={index === 0}
              onClick={() => onMove(index, -1)}
            >
              <ChevronUp />
            </Button>
            <Button
              variant="ghost" size="icon" className="size-8"
              aria-label={`Move ${widget.title} down`}
              disabled={index === total - 1}
              onClick={() => onMove(index, 1)}
            >
              <ChevronDown />
            </Button>
            <Button
              variant="ghost" size="icon" className="size-8 text-xs font-semibold"
              aria-label={`Widget size: ${widget.size.toUpperCase()} — click to cycle`}
              onClick={() => onPatch(widget.id, { size: nextSize(widget.size) })}
            >
              {widget.size.toUpperCase()}
            </Button>
            <Button
              variant="ghost" size="icon" className="size-8"
              aria-label={`Widget color: ${widget.colorTheme} — click to cycle`}
              onClick={() => onPatch(widget.id, { colorTheme: nextColor(widget.colorTheme) })}
            >
              <span className={cn('size-3.5 rounded-full border', COLOR_DOT[widget.colorTheme] ?? COLOR_DOT.default)} />
            </Button>
            <Button
              variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${widget.title}`}
              onClick={() => onRemove(widget.id)}
            >
              <X />
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-1 items-center gap-3 p-4">
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', chip)}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
        {widget.format === 'leaderboard' ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">{widget.title}</p>
            <ul className="mt-1.5 space-y-1.5">
              {(widget.rows ?? []).slice(0, 5).map((r, i) => (
                <li key={`${r.rep}-${i}`} className="flex items-center gap-2 text-sm">
                  <span className="w-4 shrink-0 text-xs font-semibold text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{r.rep}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.deals} {r.deals === 1 ? 'deal' : 'deals'}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatValue('currency', r.revenue)}</span>
                </li>
              ))}
              {(widget.rows ?? []).length === 0 && (
                <li className="text-sm text-muted-foreground">No closed-won deals yet.</li>
              )}
            </ul>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">{widget.title}</p>
            <p className="truncate text-2xl font-semibold">{formatValue(widget.format, widget.value)}</p>
          </div>
        )}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Add widget menu                                                     */
/* ------------------------------------------------------------------ */

function AddWidgetMenu({ disabled, onAdd }: { disabled: boolean; onAdd: (type: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Plus className="size-4" /> Add widget
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {Object.entries(METRIC_META).map(([type, meta]) => (
          <DropdownMenuItem key={type} onClick={() => onAdd(type)}>
            <meta.icon className="size-4" />
            {meta.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DonutChart({ stats }: { stats: Stats }) {
  const total = stats.completed + stats.inProgress + stats.notStarted || 1
  const segments = [
    { label: 'Completed', value: stats.completed, color: '#10b981' },
    { label: 'In progress', value: stats.inProgress, color: '#f59e0b' },
    { label: 'Not started', value: stats.notStarted, color: '#6b7280' },
  ]
  let offset = 0
  const radius = 60
  const circumference = 2 * Math.PI * radius

  return (
    <div className="flex items-center gap-4">
      <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="currentColor" strokeWidth="16" className="text-muted" />
        {segments.map((s) => {
          const len = (s.value / total) * circumference
          const circle = (
            <circle
              key={s.label}
              cx="70" cy="70" r={radius} fill="none"
              stroke={s.color} strokeWidth="16"
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-offset}
            />
          )
          offset += len
          return circle
        })}
      </svg>
      <ul className="space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-medium">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
