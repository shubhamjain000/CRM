'use client'

import * as React from 'react'
import { Send, Star, Inbox, Plus, Loader2, Mail } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { safeJsonParse } from '@/components/safe-json'
import { toast } from 'sonner'

/** Sentinel for "no connected mailbox selected" in the Radix Select. */
const WORKSPACE_MAILBOX = 'workspace'

/** A connected mailbox for the optional "From" selector (credentials stripped server-side). */
interface Mailbox {
  id: string
  emailAddress: string
  provider: string
  isActive: boolean
}

/** First entry of a JSON-encoded address list — never throws, never shows "undefined". */
function firstTo(raw: string | null | undefined): string {
  return safeJsonParse<string[]>(raw, [])[0] ?? '—'
}

interface Email {
  id: string; fromAddress: string; subject: string; bodyHtml: string
  direction: string; status: string; isStarred: boolean; sentAt: string | null
  receivedAt: string | null; openedAt: string | null; toAddresses: string
  createdAt: string
}

export function EmailView() {
  const [emails, setEmails] = React.useState<Email[] | null>(null)
  const [tab, setTab] = React.useState('inbox')
  const [composeOpen, setComposeOpen] = React.useState(false)
  const [compose, setCompose] = React.useState({ to: '', subject: '', body: '' })
  // Additive: optional "From" — send through a connected Gmail mailbox.
  const [mailboxes, setMailboxes] = React.useState<Mailbox[]>([])
  const [accountId, setAccountId] = React.useState(WORKSPACE_MAILBOX)
  const [selected, setSelected] = React.useState<Email | null>(null)
  const [sending, setSending] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (tab === 'starred') params.set('starred', 'true')
      if (tab === 'unread') params.set('unread', 'true')
      const res = await fetch(`/api/email/messages?${params}`, { cache: 'no-store' })
      const data = await res.json()
      setEmails(data.emails ?? [])
    } catch { setEmails([]) }
  }, [tab])

  React.useEffect(() => { load() }, [load])

  // Load connected mailboxes when the compose dialog opens (best-effort —
  // with none, composing behaves exactly as before).
  React.useEffect(() => {
    if (!composeOpen) return
    let cancelled = false
    fetch('/api/email/accounts', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((d) => {
        if (cancelled) return
        const list: Mailbox[] = (Array.isArray(d?.accounts) ? d.accounts : []).filter((a: Mailbox) => a?.isActive !== false)
        setMailboxes(list)
        const gmail = list.find((m) => m.provider === 'gmail')
        setAccountId(gmail ? gmail.id : WORKSPACE_MAILBOX)
      })
      .catch(() => { if (!cancelled) setMailboxes([]) })
    return () => { cancelled = true }
  }, [composeOpen])

  const send = async () => {
    const to = compose.to.trim()
    if (!to) { toast.error('Recipient is required'); return }
    if (!compose.subject.trim()) { toast.error('Subject is required'); return }
    setSending(true)
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: to.split(',').map((s) => s.trim()).filter(Boolean),
          subject: compose.subject.trim(),
          // Plain-text body → line breaks preserved when rendered as HTML.
          bodyHtml: compose.body ? compose.body.replace(/\n/g, '<br/>') : '',
          // Send THROUGH the chosen connected mailbox when one is selected.
          ...(accountId !== WORKSPACE_MAILBOX ? { accountId } : {}),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Failed to send')
      toast.success('Email sent')
      setComposeOpen(false)
      setCompose({ to: '', subject: '', body: '' })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const star = async (email: Email, starred: boolean) => {
    await fetch(`/api/email/messages/${email.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isStarred: starred }),
    })
    load()
  }

  const open = async (email: Email) => {
    setSelected(email)
    if (!email.openedAt && email.direction === 'inbound') {
      await fetch(`/api/email/messages/${email.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markRead: true }),
      })
      load()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email</h1>
          <p className="text-muted-foreground">Inbox + compose</p>
        </div>
        <Button onClick={() => setComposeOpen(true)}><Plus className="mr-1.5 size-4" /> Compose</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="inbox"><Inbox className="mr-1.5 size-3.5" /> Inbox</TabsTrigger>
          <TabsTrigger value="starred"><Star className="mr-1.5 size-3.5" /> Starred</TabsTrigger>
          <TabsTrigger value="unread">Unread</TabsTrigger>
          <TabsTrigger value="sent">Sent</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
            {/* Email list */}
            <Card>
              <CardContent className="p-0">
                {!emails ? <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div> :
                 emails.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">No emails</div> :
                 <ul className="divide-y max-h-[70vh] overflow-y-auto">
                   {emails.map((e) => (
                     <li key={e.id} onClick={() => open(e)}
                       className={`flex cursor-pointer items-start gap-3 p-3 transition hover:bg-muted/30 ${selected?.id === e.id ? 'bg-muted/30' : ''} ${!e.openedAt && e.direction === 'inbound' ? 'font-semibold' : ''}`}>
                       <button onClick={(ev) => { ev.stopPropagation(); star(e, !e.isStarred) }} className="mt-0.5">
                         <Star className={`size-4 ${e.isStarred ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground'}`} />
                       </button>
                       <div className="min-w-0 flex-1">
                         <div className="flex items-center gap-2">
                           <span className="truncate text-sm font-medium">{e.direction === 'outbound' ? 'To: ' + firstTo(e.toAddresses) : e.fromAddress}</span>
                           {!e.openedAt && e.direction === 'inbound' && <span className="size-2 shrink-0 rounded-full bg-blue-500" />}
                           <span className="ml-auto text-xs text-muted-foreground">{new Date(e.receivedAt || e.sentAt || e.createdAt).toLocaleDateString()}</span>
                         </div>
                         <p className="truncate text-sm">{e.subject}</p>
                         <p className="truncate text-xs text-muted-foreground">{e.bodyHtml.replace(/<[^>]+>/g, '').slice(0, 80)}</p>
                       </div>
                     </li>
                   ))}
                 </ul>}
              </CardContent>
            </Card>

            {/* Email detail */}
            <Card>
              {selected ? (
                <>
                  <CardHeader>
                    <CardTitle className="text-base">{selected.subject}</CardTitle>
                    <p className="text-sm text-muted-foreground">{selected.direction === 'outbound' ? 'To: ' + firstTo(selected.toAddresses) : selected.fromAddress}</p>
                    <p className="text-xs text-muted-foreground">{new Date(selected.receivedAt || selected.sentAt || selected.createdAt).toLocaleString()}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: selected.bodyHtml }} />
                  </CardContent>
                </>
              ) : (
                <CardContent className="py-16 text-center text-sm text-muted-foreground">Select an email to read</CardContent>
              )}
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Compose dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mail className="size-4 text-primary" /> New Email</DialogTitle>
            <DialogDescription>Compose a message from the workspace mailbox.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email-compose-to">To</Label>
              <Input id="email-compose-to" value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })} placeholder="recipient@example.com" inputMode="email" />
              <p className="text-xs text-muted-foreground">Separate multiple addresses with commas.</p>
            </div>
            {mailboxes.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="email-compose-from">From</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger id="email-compose-from" aria-label="From mailbox">
                    <SelectValue placeholder="Workspace mailbox" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={WORKSPACE_MAILBOX}>Workspace mailbox</SelectItem>
                    {mailboxes.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.emailAddress}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email-compose-subject">Subject</Label>
              <Input id="email-compose-subject" value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} placeholder="What is this about?" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-compose-body">Message</Label>
              <Textarea id="email-compose-body" value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} rows={8} placeholder="Write your email..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={send} disabled={sending || !compose.to.trim() || !compose.subject.trim()}>
              {sending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Send className="mr-1.5 size-4" />}
              {sending ? 'Sending…' : 'Send email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
