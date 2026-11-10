'use client'

import * as React from 'react'
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Plus, MessageSquare, Send, Trash2, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

interface Call {
  id: string; fromNumber: string; toNumber: string; direction: string
  status: string; duration: number; outcome: string | null; startedAt: string; notes: string | null
}

interface SmsTemplate { id: string; name: string; body: string; variables: string; category: string }
interface SmsMessage { id: string; toNumber: string; body: string; status: string; sentAt: string | null; segments: number }

export function TelephonyView() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Telephony</h1>
        <p className="text-muted-foreground">Calls + SMS</p>
      </div>
      <Tabs defaultValue="calls">
        <TabsList>
          <TabsTrigger value="calls"><Phone className="mr-1.5 size-3.5" /> Calls</TabsTrigger>
          <TabsTrigger value="sms"><MessageSquare className="mr-1.5 size-3.5" /> SMS</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="calls" className="mt-4"><CallsTab /></TabsContent>
        <TabsContent value="sms" className="mt-4"><SmsTab /></TabsContent>
        <TabsContent value="templates" className="mt-4"><TemplatesTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function CallsTab() {
  const [calls, setCalls] = React.useState<Call[] | null>(null)
  const [logOpen, setLogOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({ toNumber: '', direction: 'outbound', outcome: 'connected', duration: 0, notes: '' })

  const load = React.useCallback(async () => {
    const res = await fetch('/api/telephony/calls', { cache: 'no-store' })
    const data = await res.json()
    setCalls(data.calls ?? [])
  }, [])
  React.useEffect(() => { load() }, [load])

  const log = async () => {
    if (!form.toNumber.trim()) { toast.error('Phone number is required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/telephony/calls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          toNumber: form.toNumber.trim(),
          duration: Math.max(0, Math.round(form.duration || 0)),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Failed to log call')
      toast.success('Call logged')
      setLogOpen(false)
      setForm({ toNumber: '', direction: 'outbound', outcome: 'connected', duration: 0, notes: '' })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to log call')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Call History</CardTitle>
        <Button size="sm" onClick={() => setLogOpen(true)}><Plus className="mr-1 size-4" /> Log call</Button>
      </CardHeader>
      <CardContent className="p-0">
        {!calls ? <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div> :
         calls.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">No calls yet</div> :
         <ul className="divide-y">
           {calls.map((c) => (
             <li key={c.id} className="flex items-center gap-3 p-3">
               <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                 {c.direction === 'inbound' ? <PhoneIncoming className="size-4 text-blue-500" /> :
                  c.direction === 'missed' ? <PhoneMissed className="size-4 text-destructive" /> :
                  <PhoneOutgoing className="size-4 text-emerald-500" />}
               </div>
               <div className="min-w-0 flex-1">
                 <p className="text-sm font-medium">{c.direction === 'outbound' ? c.toNumber : c.fromNumber}</p>
                 <p className="text-xs text-muted-foreground">{new Date(c.startedAt).toLocaleString()} · {c.duration}s · {c.outcome}</p>
               </div>
               <Badge variant="outline" className="text-[10px] capitalize">{c.status}</Badge>
             </li>
           ))}
         </ul>}
      </CardContent>
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Phone className="size-4 text-primary" /> Log a call</DialogTitle>
            <DialogDescription>Record the conversation in the workspace call history.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="logcall-number">Phone number</Label>
              <Input id="logcall-number" value={form.toNumber} onChange={(e) => setForm({ ...form, toNumber: e.target.value })} placeholder="+91 98765 43210" inputMode="tel" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="logcall-direction">Direction</Label>
                <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                  <SelectTrigger id="logcall-direction" aria-label="Call direction"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="outbound">Outbound</SelectItem><SelectItem value="inbound">Inbound</SelectItem><SelectItem value="missed">Missed</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="logcall-outcome">Outcome</Label>
                <Select value={form.outcome} onValueChange={(v) => setForm({ ...form, outcome: v })}>
                  <SelectTrigger id="logcall-outcome" aria-label="Call outcome"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="connected">Connected</SelectItem><SelectItem value="voicemail">Voicemail</SelectItem><SelectItem value="no_answer">No answer</SelectItem><SelectItem value="busy">Busy</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logcall-duration">Duration (seconds)</Label>
              <Input id="logcall-duration" type="number" min={0} step={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} placeholder="e.g. 180" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logcall-notes">Notes</Label>
              <Textarea id="logcall-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Summary of the conversation…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={log} disabled={saving || !form.toNumber.trim()}>
              {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Phone className="mr-1.5 size-4" />}
              {saving ? 'Saving…' : 'Log call'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function SmsTab() {
  const [messages, setMessages] = React.useState<SmsMessage[] | null>(null)
  const [templates, setTemplates] = React.useState<SmsTemplate[]>([])
  const [form, setForm] = React.useState({ toNumber: '', body: '', templateId: '' })

  const load = React.useCallback(async () => {
    const [m, t] = await Promise.all([
      fetch('/api/telephony/sms', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/telephony/sms/templates', { cache: 'no-store' }).then((r) => r.json()),
    ])
    setMessages(m.messages ?? [])
    setTemplates(t.templates ?? [])
  }, [])
  React.useEffect(() => { load() }, [load])

  const send = async () => {
    if (!form.toNumber || !form.body) return
    await fetch('/api/telephony/sms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toNumber: form.toNumber, body: form.body, templateId: form.templateId || undefined }),
    })
    toast.success('SMS sent')
    setForm({ toNumber: '', body: '', templateId: '' })
    load()
  }

  const loadTemplate = (id: string) => {
    const t = templates.find((t) => t.id === id)
    if (t) setForm({ ...form, templateId: id, body: t.body })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      <Card>
        <CardHeader><CardTitle className="text-base">SMS Messages</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!messages ? <Skeleton className="h-48 w-full" /> :
           messages.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">No messages</div> :
           <ul className="divide-y max-h-96 overflow-y-auto">
             {messages.map((m) => (
               <li key={m.id} className="p-3">
                 <div className="flex items-center justify-between">
                   <span className="text-sm font-medium">{m.toNumber}</span>
                   <Badge variant="outline" className="text-[10px]">{m.status}</Badge>
                 </div>
                 <p className="text-sm text-muted-foreground">{m.body.slice(0, 80)}</p>
                 <p className="text-xs text-muted-foreground">{m.sentAt ? new Date(m.sentAt).toLocaleString() : ''} · {m.segments} segment(s)</p>
               </li>
             ))}
           </ul>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Send SMS</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>To</Label><Input value={form.toNumber} onChange={(e) => setForm({ ...form, toNumber: e.target.value })} placeholder="+1234567890" /></div>
          <div>
            <Label>Template (optional)</Label>
            <Select value={form.templateId} onValueChange={loadTemplate}>
              <SelectTrigger><SelectValue placeholder="Pick a template" /></SelectTrigger>
              <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Message</Label><Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} placeholder="Use {{first_name}} for variables" /></div>
          <p className="text-xs text-muted-foreground">{form.body.length} chars · {Math.ceil(form.body.length / 160)} segment(s)</p>
          <Button onClick={send} disabled={!form.toNumber || !form.body} className="w-full"><Send className="mr-1.5 size-4" /> Send</Button>
        </CardContent>
      </Card>
    </div>
  )
}

function TemplatesTab() {
  const [templates, setTemplates] = React.useState<SmsTemplate[] | null>(null)
  const [form, setForm] = React.useState({ name: '', body: '', category: 'transactional' })

  const load = React.useCallback(async () => {
    const res = await fetch('/api/telephony/sms/templates', { cache: 'no-store' })
    const data = await res.json()
    setTemplates(data.templates ?? [])
  }, [])
  React.useEffect(() => { load() }, [load])

  const create = async () => {
    if (!form.name || !form.body) return
    await fetch('/api/telephony/sms/templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    toast.success('Template created')
    setForm({ name: '', body: '', category: 'transactional' })
    load()
  }

  const del = async (id: string) => {
    await fetch(`/api/telephony/sms/templates/${id}`, { method: 'DELETE' })
    toast.success('Deleted')
    load()
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">SMS Templates</CardTitle><CardDescription>Pre-approved with variable support</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border p-3">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Template name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="transactional">Transactional</SelectItem><SelectItem value="promotional">Promotional</SelectItem><SelectItem value="otp">OTP</SelectItem></SelectContent>
            </Select>
          </div>
          <Textarea placeholder="Hi {{first_name}}, your appointment is at {{time}}." value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={2} />
          <Button size="sm" onClick={create}><Plus className="mr-1 size-4" /> Add template</Button>
        </div>
        {!templates ? <Skeleton className="h-32 w-full" /> :
         <ul className="divide-y rounded-lg border">
           {templates.map((t) => (
             <li key={t.id} className="flex items-center gap-3 p-3">
               <div className="flex-1">
                 <div className="flex items-center gap-2"><span className="font-medium">{t.name}</span><Badge variant="outline" className="text-[10px] capitalize">{t.category}</Badge></div>
                 <p className="text-xs text-muted-foreground">{t.body.slice(0, 80)}</p>
               </div>
               <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => del(t.id)}><Trash2 className="size-3.5" /></Button>
             </li>
           ))}
         </ul>}
      </CardContent>
    </Card>
  )
}
