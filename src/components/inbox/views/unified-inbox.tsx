'use client'

import * as React from 'react'
import { Mail, MessageCircle, Phone, MessageSquare, Globe, Send, Tag, User, Clock, Sparkles, X, Plus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { safeJsonParse } from '@/components/safe-json'
import { toast } from 'sonner'

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  email: Mail, whatsapp: MessageCircle, telephony: Phone,
  livechat: MessageSquare, social: Globe, sms: MessageSquare,
}

const CHANNEL_COLORS: Record<string, string> = {
  email: 'text-blue-500', whatsapp: 'text-emerald-500', telephony: 'text-purple-500',
  livechat: 'text-amber-500', social: 'text-pink-500', sms: 'text-cyan-500',
}

interface Conversation {
  id: string; channel: string; participantName: string; participantIdentifier: string
  subject: string | null; status: string; priority: string; lastMessageAt: string
  messageCount: number; tags: string; assignedToId: string | null
}

interface Message {
  id: string; sender: string; body: string; channel: string; timestamp: string
}

export function UnifiedInboxView() {
  const [conversations, setConversations] = React.useState<Conversation[] | null>(null)
  const [selected, setSelected] = React.useState<Conversation | null>(null)
  const [messages, setMessages] = React.useState<Message[] | null>(null)
  const [reply, setReply] = React.useState('')
  const [filter, setFilter] = React.useState<string>('all')
  const [search, setSearch] = React.useState('')
  const [internalNote, setInternalNote] = React.useState('')
  const [analytics, setAnalytics] = React.useState<{ total: number; open: number; resolved: number; closed: number; channelDistribution: Record<string, number> } | null>(null)
  const [tagInput, setTagInput] = React.useState('')

  const searchRef = React.useRef(search)
  searchRef.current = search
  const loadSeq = React.useRef(0)

  const load = React.useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set(filter === 'mine' ? 'mine' : 'channel', filter === 'mine' ? 'true' : filter)
      const s = searchRef.current
      if (s) params.set('search', s)
      const res = await fetch(`/api/inbox/conversations?${params}`, { cache: 'no-store' })
      const data = await res.json()
      if (seq === loadSeq.current) setConversations(data.conversations ?? [])
    } catch { if (seq === loadSeq.current) setConversations([]) }
  }, [filter])

  const loadAnalytics = React.useCallback(async () => {
    try {
      const res = await fetch('/api/inbox/analytics', { cache: 'no-store' })
      const data = await res.json()
      setAnalytics(data)
    } catch {}
  }, [])

  React.useEffect(() => {
    let alive = true
    ;(async () => {
      // Best-effort WhatsApp sync — pulls the connector's chat log into the
      // inbox before the first fetch. Silently skipped when the connector
      // service is down; the inbox still loads from the database.
      try {
        const res = await fetch('/api/inbox/whatsapp/sync', { method: 'POST', cache: 'no-store' })
        const data = await res.json().catch(() => null)
        if (alive && data?.ok && data?.imported > 0) {
          toast.success(`Synced ${data.imported} WhatsApp message${data.imported === 1 ? '' : 's'} into the inbox`)
        }
      } catch { /* connector offline — inbox still loads */ }
      if (alive) { load(); loadAnalytics() }
    })()

    // Keep a live inbox live: while the view is open, re-sync the WhatsApp
    // connector log every 20s so new chat messages appear without a manual
    // revisit. The sync endpoint is idempotent (connector-id dedupe), so the
    // poll is cheap — when nothing new arrived it imports 0 rows.
    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/inbox/whatsapp/sync', { method: 'POST', cache: 'no-store' })
        const data = await res.json().catch(() => null)
        if (alive && data?.ok && data?.imported > 0) {
          toast.success(`Synced ${data.imported} new WhatsApp message${data.imported === 1 ? '' : 's'}`)
          load()
          loadAnalytics()
        }
      } catch { /* connector offline — retry next tick */ }
    }, 20_000)

    return () => { alive = false; clearInterval(poll) }
  }, [load, loadAnalytics])

  // Debounce search-triggered refetches (300ms) and ignore stale responses
  React.useEffect(() => {
    if (!search) return
    const t = setTimeout(() => load(), 300)
    return () => clearTimeout(t)
  }, [search, load])

  const loadMessages = async (conv: Conversation) => {
    setSelected(conv)
    setMessages(null)
    try {
      const res = await fetch(`/api/inbox/conversations/${conv.id}`, { cache: 'no-store' })
      const data = await res.json()
      setMessages(data.conversation?.messages ?? [])
    } catch { setMessages([]) }
  }

  const sendReply = async () => {
    if (!selected || !reply.trim()) return
    try {
      const res = await fetch(`/api/inbox/conversations/${selected.id}/reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: reply }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Reply sent')
      setReply('')
      loadMessages(selected)
      load()
    } catch { toast.error('Send failed') }
  }

  const close = async () => {
    if (!selected) return
    await fetch(`/api/inbox/conversations/${selected.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ close: true }),
    })
    toast.success('Conversation closed')
    load()
  }

  const addNote = async () => {
    if (!selected || !internalNote.trim()) return
    await fetch(`/api/inbox/conversations/${selected.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ internalNote }),
    })
    toast.success('Note added')
    setInternalNote('')
  }

  const addTag = async () => {
    if (!selected || !tagInput.trim()) return
    const currentTags = safeJsonParse<string[]>(selected.tags, [])
    const newTags = [...new Set([...currentTags, tagInput.trim()])]
    await fetch(`/api/inbox/conversations/${selected.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags }),
    })
    setTagInput('')
    load()
    setSelected({ ...selected, tags: JSON.stringify(newTags) })
  }

  const seed = async () => {
    await fetch('/api/inbox/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seed' }),
    })
    toast.success('Sample conversations created')
    load(); loadAnalytics()
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Unified Inbox</h1>
          <p className="text-sm text-muted-foreground">
            {analytics ? `${analytics.total} conversations · ${analytics.open} open` : 'Loading…'}
          </p>
        </div>
        <div className="flex gap-2">
          {conversations?.length === 0 && <Button size="sm" variant="outline" onClick={seed}><Sparkles className="mr-1.5 size-4" /> Seed sample</Button>}
        </div>
      </div>

      {/* Channel filter tabs */}
      <div className="flex items-center gap-2 ribbon">
        <Button variant={filter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('all')}>All</Button>
        {['email', 'whatsapp', 'livechat', 'social', 'sms', 'mine'].map((ch) => (
          <Button key={ch} variant={filter === ch ? 'default' : 'outline'} size="sm" className="capitalize" onClick={() => setFilter(ch)}>
            {ch === 'mine' ? 'Assigned to me' : ch}
          </Button>
        ))}
        <div className="relative ml-auto">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-8 w-48" />
        </div>
      </div>

      {/* 3-pane layout */}
      <div className="grid flex-1 gap-3 overflow-hidden lg:grid-cols-[300px_1fr_280px]">
        {/* Left: conversation list */}
        <Card className="flex flex-col overflow-hidden">
          <CardContent className="flex-1 overflow-y-auto p-0">
            {!conversations ? (
              <div className="space-y-2 p-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12">
                <MessageSquare className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No conversations</p>
                <Button size="sm" variant="outline" onClick={seed}>Seed sample data</Button>
              </div>
            ) : (
              <ul className="divide-y">
                {conversations.map((c) => {
                  const Icon = CHANNEL_ICONS[c.channel] ?? MessageSquare
                  return (
                    <li key={c.id} onClick={() => loadMessages(c)}
                      className={`flex cursor-pointer items-start gap-2.5 p-3 transition hover:bg-muted/30 ${selected?.id === c.id ? 'bg-muted/30' : ''}`}>
                      <div className={`mt-0.5 ${CHANNEL_COLORS[c.channel] ?? 'text-muted-foreground'}`}><Icon className="size-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{c.participantName}</span>
                          {c.priority === 'urgent' && <span className="size-1.5 rounded-full bg-destructive" />}
                          <span className="ml-auto text-xs text-muted-foreground">{new Date(c.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{c.subject ?? c.participantIdentifier}</p>
                        <div className="mt-0.5 flex items-center gap-1">
                          <Badge variant="outline" className="text-[9px] capitalize">{c.status}</Badge>
                          {c.messageCount > 0 && <span className="text-[10px] text-muted-foreground">{c.messageCount} msgs</span>}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Center: conversation thread */}
        <Card className="flex flex-col overflow-hidden">
          {selected ? (
            <>
              {/* Thread header */}
              <div className="flex items-center justify-between border-b p-3">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = CHANNEL_ICONS[selected.channel] ?? MessageSquare
                    return <Icon className={`size-4 ${CHANNEL_COLORS[selected.channel]}`} />
                  })()}
                  <div>
                    <p className="text-sm font-medium">{selected.participantName}</p>
                    <p className="text-xs text-muted-foreground">{selected.subject ?? selected.participantIdentifier}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={close}>Close</Button>
              </div>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3">
                {!messages ? <Skeleton className="h-full w-full" /> :
                 messages.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No messages</p> :
                 <div className="space-y-3">
                   {messages.map((m) => (
                     <div key={m.id} className={`flex ${m.sender === 'agent' ? 'justify-end' : 'justify-start'}`}>
                       <div className={`max-w-[70%] rounded-lg p-2.5 text-sm ${m.sender === 'agent' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                         <p>{m.body}</p>
                         <p className={`mt-0.5 text-[10px] ${m.sender === 'agent' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                           {new Date(m.timestamp).toLocaleTimeString()} · {m.sender}
                         </p>
                       </div>
                     </div>
                   ))}
                 </div>}
               </div>
               {/* Reply composer */}
               <div className="border-t p-3">
                 <div className="flex items-center gap-2">
                   <Input value={reply} onChange={(e) => setReply(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                     placeholder={`Reply via ${selected.channel}…`} className="flex-1" />
                   <Button size="icon" onClick={sendReply} disabled={!reply.trim()}><Send className="size-4" /></Button>
                 </div>
               </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select a conversation</div>
          )}
        </Card>

        {/* Right: context panel */}
        <Card className="flex flex-col overflow-hidden">
          {selected ? (
            <div className="flex flex-col gap-3 overflow-y-auto p-3">
              {/* Participant info */}
              <div className="flex items-center gap-2">
                <Avatar className="size-10"><AvatarFallback className="bg-primary/10 text-primary text-xs">{selected.participantName.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{selected.participantName}</p>
                  <p className="truncate text-xs text-muted-foreground">{selected.participantIdentifier}</p>
                </div>
              </div>

              {/* Status + priority */}
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">{selected.status}</Badge>
                <Badge variant="outline" className={`capitalize ${selected.priority === 'urgent' ? 'border-destructive/40 text-destructive' : ''}`}>{selected.priority}</Badge>
              </div>

              {/* Tags */}
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {safeJsonParse<string[]>(selected.tags, []).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]"><Tag className="mr-0.5 size-2.5" />{t}</Badge>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-1">
                  <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Add tag…" className="h-7 text-xs" onKeyDown={(e) => { if (e.key === 'Enter') addTag() }} />
                  <Button size="sm" variant="ghost" className="h-7" onClick={addTag}><Plus className="size-3" /></Button>
                </div>
              </div>

              {/* SLA timer */}
              <div className="rounded-lg border p-2">
                <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Clock className="size-3" /> SLA</p>
                <p className="mt-0.5 text-xs">Last message: {new Date(selected.lastMessageAt).toLocaleString()}</p>
              </div>

              {/* Internal notes */}
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Internal Notes</p>
                <div className="space-y-1">
                  <Input value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="Add note (not visible to customer)…" className="h-7 text-xs" />
                  <Button size="sm" variant="outline" className="w-full" onClick={addNote}>Add Note</Button>
                </div>
              </div>

              {/* Channel distribution (if analytics loaded) */}
              {analytics && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Channel Distribution</p>
                  <div className="space-y-1">
                    {Object.entries(analytics.channelDistribution).filter(([, v]) => v > 0).map(([ch, count]) => {
                      const Icon = CHANNEL_ICONS[ch] ?? MessageSquare
                      return (
                        <div key={ch} className="flex items-center gap-2 text-xs">
                          <Icon className={`size-3 ${CHANNEL_COLORS[ch]}`} />
                          <span className="capitalize">{ch}</span>
                          <span className="ml-auto font-medium">{count}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Context panel</div>
          )}
        </Card>
      </div>
    </div>
  )
}
