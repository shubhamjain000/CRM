'use client'

import * as React from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

interface CalEvent {
  id: string; title: string; start: string; end: string
  allDay: boolean; status: string; organizerId: string
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: '#3b82f6', tentative: '#f59e0b', cancelled: '#ef4444',
}

export function CalendarView() {
  const [events, setEvents] = React.useState<CalEvent[]>([])
  const [loading, setLoading] = React.useState(true)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [newEvent, setNewEvent] = React.useState({ title: '', start: '', end: '' })
  const calendarRef = React.useRef<FullCalendar>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
      const end = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString()
      const res = await fetch(`/api/productivity/events?startAfter=${start}&startBefore=${end}`, { cache: 'no-store' })
      const data = await res.json()
      setEvents((data.events ?? []).map((e: CalEvent) => ({
        ...e, color: STATUS_COLORS[e.status] ?? STATUS_COLORS.confirmed,
      })))
    } catch {
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleDateSelect = (selectInfo: { startStr: string; endStr: string }) => {
    setNewEvent({ title: '', start: selectInfo.startStr, end: selectInfo.endStr })
    setCreateOpen(true)
  }

  const handleEventDrop = async (info: { event: { id: string; start: Date | null; end: Date | null } }) => {
    const { id, start, end } = info.event
    if (!start) return
    try {
      await fetch(`/api/productivity/events/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: start.toISOString(), end: end?.toISOString() }),
      })
      toast.success('Event rescheduled')
    } catch {
      toast.error('Reschedule failed')
      load()
    }
  }

  const handleEventResize = async (info: { event: { id: string; start: Date | null; end: Date | null } }) => {
    const { id, start, end } = info.event
    if (!start || !end) return
    try {
      await fetch(`/api/productivity/events/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: start.toISOString(), end: end.toISOString() }),
      })
      toast.success('Event resized')
    } catch {
      toast.error('Resize failed')
    }
  }

  const createEvent = async () => {
    try {
      const res = await fetch('/api/productivity/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newEvent.title, start: newEvent.start, end: newEvent.end,
          allDay: false, status: 'confirmed',
        }),
      })
      const data = await res.json()
      if (res.status === 409) {
        toast.error('Conflict detected', { description: 'You have another event at this time' })
        return
      }
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Event created')
      setCreateOpen(false)
      setNewEvent({ title: '', start: '', end: '' })
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">{events.length} events this period</p>
        </div>
        <Button onClick={() => { setNewEvent({ title: '', start: new Date().toISOString(), end: new Date(Date.now() + 3600000).toISOString() }); setCreateOpen(true) }}>
          New event
        </Button>
      </div>

      <Card>
        <CardContent className="p-2 sm:p-4">
          {loading ? (
            <div className="h-96 animate-pulse rounded bg-muted" />
          ) : (
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
              initialView="timeGridWeek"
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
              }}
              events={events}
              editable
              selectable
              selectMirror
              dayMaxEvents
              select={handleDateSelect}
              eventDrop={handleEventDrop}
              eventResize={handleEventResize}
              height="auto"
              nowIndicator
              slotMinTime="07:00:00"
              slotMaxTime="21:00:00"
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New event</DialogTitle>
            <DialogDescription>{newEvent.start && `From ${new Date(newEvent.start).toLocaleString()}`}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={newEvent.title} onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createEvent} disabled={!newEvent.title}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
