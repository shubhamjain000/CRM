'use client'

import * as React from 'react'
import {
  Mail, MessageCircle, Phone, Plug, Plus, Trash2, CheckCircle2, XCircle,
  RefreshCw, Loader2, ShieldCheck, KeyRound, ExternalLink, ChevronRight,
  AlertTriangle, Copy, Inbox, Lock,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { usePermissions } from '@/lib/auth/client-permissions'
import {
  useWaChats, useWaConnector, WaChatExperience, WaConnectorCard, WaLockedCard,
} from '../wa-chat-list'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface EmailAccount {
  id: string; provider: string; emailAddress: string; syncEnabled: boolean
  syncFrequency: number; lastSyncedAt: string | null; isActive: boolean; createdAt: string
  authMode?: string | null; lastSyncError?: string | null
}
interface WhatsAppAccount {
  id: string; displayName: string; displayPhoneNumber: string; wabaId: string
  phoneNumberId: string; isVerified: boolean; qualityRating: string; createdAt: string
}
interface PhoneNumber {
  id: string; number: string; provider: string; capabilities: string
  isActive: boolean; region: string | null; friendlyName: string | null; createdAt: string
}
interface IntegrationRow {
  id: string; provider: string; isConnected: boolean; config: Record<string, string>
  lastSyncedAt: string | null; createdAt: string
}
interface IntegrationDef {
  provider: string; name: string; category: string; description: string
  fields: { key: string; label: string; type: 'text' | 'password'; placeholder?: string; required?: boolean }[]
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function ChannelsView() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
        <p className="text-muted-foreground">Connect mailboxes, WhatsApp Business, phone numbers and third-party integrations.</p>
      </div>
      <Tabs defaultValue="email">
        <TabsList className="flex-wrap">
          <TabsTrigger value="email"><Mail className="mr-1.5 size-3.5" /> Email</TabsTrigger>
          <TabsTrigger value="whatsapp"><MessageCircle className="mr-1.5 size-3.5" /> WhatsApp</TabsTrigger>
          <TabsTrigger value="phone"><Phone className="mr-1.5 size-3.5" /> Phone numbers</TabsTrigger>
          <TabsTrigger value="integrations"><Plug className="mr-1.5 size-3.5" /> Integrations</TabsTrigger>
        </TabsList>
        <TabsContent value="email" className="mt-4"><EmailTab /></TabsContent>
        <TabsContent value="whatsapp" className="mt-4"><WhatsAppTab /></TabsContent>
        <TabsContent value="phone" className="mt-4"><PhoneTab /></TabsContent>
        <TabsContent value="integrations" className="mt-4"><IntegrationsTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Email tab
// ---------------------------------------------------------------------------

const EMAIL_PROVIDERS = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook / Office 365' },
  { value: 'exchange', label: 'Exchange' },
  { value: 'imap', label: 'IMAP / SMTP' },
  { value: 'yahoo', label: 'Yahoo' },
  { value: 'custom', label: 'Custom' },
]

// ---------------------------------------------------------------------------
// Google email connector — real OAuth2 + Gmail API
// ---------------------------------------------------------------------------

/** Official four-color Google "G". */
function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51z" />
    </svg>
  )
}

/** Toast for the OAuth redirect return (?gmail=connected|error&message=…) —
 *  mounted once app-wide so the result surfaces no matter which view is open. */
export function GmailConnectorResultToast() {
  React.useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      const status = p.get('gmail')
      if (!status) return
      const message = p.get('message') || ''
      if (status === 'connected') toast.success(message || 'Gmail mailbox connected')
      else toast.error(message || 'Google connection failed')
      p.delete('gmail'); p.delete('message'); p.delete('email')
      const qs = p.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
    } catch { /* never block render */ }
  }, [])
  return null
}

function GoogleConnectorCard({ onChanged, accounts, canManage }: { onChanged: () => void; accounts: EmailAccount[] | null; canManage: boolean }) {
  const [setup, setSetup] = React.useState<{ configured: boolean; redirectUri: string } | null>(null)
  const [cfgOpen, setCfgOpen] = React.useState(false)
  const [clientId, setClientId] = React.useState('')
  const [clientSecret, setClientSecret] = React.useState('')
  const [savingCfg, setSavingCfg] = React.useState(false)
  const [qpEmail, setQpEmail] = React.useState('')
  const [qpPassword, setQpPassword] = React.useState('')
  const [qpBusy, setQpBusy] = React.useState(false)
  const [syncingAll, setSyncingAll] = React.useState(false)

  React.useEffect(() => {
    fetch('/api/email/google/setup', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d?.redirectUri) setSetup({ configured: Boolean(d.configured), redirectUri: d.redirectUri }) })
      .catch(() => {})
  }, [])

  const saveCfg = async () => {
    setSavingCfg(true)
    try {
      const res = await fetch('/api/email/google/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to save')
      toast.success('Google OAuth credentials saved')
      setSetup((s) => (s ? { ...s, configured: true } : s))
      setCfgOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally { setSavingCfg(false) }
  }

  const quickConnect = async () => {
    setQpBusy(true)
    try {
      const res = await fetch('/api/email/google/app-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailAddress: qpEmail, appPassword: qpPassword }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to connect')
      toast.success(`${qpEmail} connected — verified against Gmail SMTP`)
      if (data?.sync?.error) toast.warning(`Connected, but first sync failed: ${data.sync.error}`)
      else if (typeof data?.sync?.synced === 'number') toast.success(`First sync pulled ${data.sync.synced} message${data.sync.synced === 1 ? '' : 's'}`)
      setQpEmail(''); setQpPassword('')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to connect')
    } finally { setQpBusy(false) }
  }

  const syncAll = async () => {
    setSyncingAll(true)
    try {
      const res = await fetch('/api/email/google/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Sync failed')
      const results: { emailAddress: string; synced: number; error?: string }[] = data?.results ?? []
      const total = results.reduce((n, r) => n + (r.synced || 0), 0)
      const failed = results.filter((r) => r.error)
      if (failed.length) toast.warning(`${total} new message${total === 1 ? '' : 's'} · ${failed.length} account${failed.length === 1 ? '' : 's'} failed: ${failed[0].error?.slice(0, 120)}`)
      else toast.success(`Sync complete — ${total} new message${total === 1 ? '' : 's'}`)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed')
    } finally { setSyncingAll(false) }
  }

  const copyRedirect = async () => {
    if (!setup) return
    try { await navigator.clipboard.writeText(setup.redirectUri); toast.success('Redirect URI copied') }
    catch { toast.error('Copy failed — select the text manually') }
  }

  const gmailAccounts = accounts?.filter((a) => a.provider === 'gmail') ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-white dark:bg-muted">
              <GoogleG className="size-6" />
            </div>
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                Google (Gmail)
                {setup === null ? (
                  <Badge variant="secondary" className="gap-1"><Loader2 className="size-3 animate-spin" /> Checking…</Badge>
                ) : setup.configured ? (
                  <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3" /> Ready</Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400"><AlertTriangle className="size-3" /> Setup needed</Badge>
                )}
              </CardTitle>
              <CardDescription>Connect Gmail with one click (OAuth) or an App Password. Syncs inbox and sends as the connected address.</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {gmailAccounts.length > 0 && (
              <Button size="sm" className="min-h-9" variant="outline" onClick={syncAll} disabled={!canManage || syncingAll} title={canManage ? undefined : 'Admin users only'}>
                {syncingAll ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />} Sync all
              </Button>
            )}
            <Button
              size="sm"
              className="min-h-9"
              onClick={() => { window.location.href = '/api/email/google/authorize' }}
              disabled={!canManage || !setup?.configured}
              title={canManage ? undefined : 'Admin users only'}
              aria-label="Connect a Gmail mailbox with Google OAuth"
            >
              <GoogleG className="mr-1.5 size-4" /> Connect with Google
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {!setup?.configured && (
          <Alert>
            <ShieldCheck className="size-4 shrink-0" />
            <AlertDescription className="text-xs">
              One-time setup: paste your Google Cloud OAuth Client ID &amp; Secret below. Gmail mailboxes then connect with a single click.
            </AlertDescription>
          </Alert>
        )}
        <Collapsible open={cfgOpen} onOpenChange={setCfgOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground" aria-expanded={cfgOpen}>
              <KeyRound className="mr-1.5 size-3.5" /> {setup?.configured ? 'View / update Google OAuth credentials' : 'Set up Google OAuth credentials'}
              <ChevronRight className={`ml-1 size-3.5 transition-transform ${cfgOpen ? 'rotate-90' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              <li>
                In{' '}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2">
                  Google Cloud Console → Credentials <ExternalLink className="size-3" />
                </a>
                , create an <span className="font-medium text-foreground">OAuth client ID</span> (type: Web application) with the Gmail API enabled.
              </li>
              <li>
                Register this exact redirect URI:{' '}
                <code className="max-w-full break-all rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{setup?.redirectUri ?? '…'}</code>
                <Button size="sm" variant="ghost" className="ml-1 h-6 px-1.5" onClick={copyRedirect} aria-label="Copy redirect URI"><Copy className="size-3" /></Button>
              </li>
              <li>Paste the Client ID and Secret here and save — then hit “Connect with Google”.</li>
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="g-cid">OAuth Client ID</Label>
                <Input id="g-cid" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxx.apps.googleusercontent.com" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-cs">OAuth Client Secret</Label>
                <Input id="g-cs" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GOCSPX-…" autoComplete="off" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" className="min-h-9" onClick={saveCfg} disabled={!canManage || savingCfg || !clientId.trim() || !clientSecret.trim()} title={canManage ? undefined : 'Admin users only'}>
                {savingCfg ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <ShieldCheck className="mr-1.5 size-4" />} Save credentials
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or quick connect</span>
          <Separator className="flex-1" />
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="g-qp-email" className="sr-only">Gmail address</Label>
            <Input id="g-qp-email" type="email" value={qpEmail} onChange={(e) => setQpEmail(e.target.value)} placeholder="you@gmail.com" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-qp-pass" className="sr-only">App password</Label>
            <Input id="g-qp-pass" type="password" value={qpPassword} onChange={(e) => setQpPassword(e.target.value)} placeholder="16-character App Password" autoComplete="off" />
          </div>
          <Button onClick={quickConnect} disabled={!canManage || qpBusy || !qpEmail.trim() || qpPassword.replace(/\s+/g, '').length !== 16} title={canManage ? undefined : 'Admin users only'} className="self-end min-h-9">
            {qpBusy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Plug className="mr-1.5 size-4" />} Connect &amp; verify
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          App Password path: enable 2-Step Verification, generate a password at{' '}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
            myaccount.google.com/apppasswords <ExternalLink className="size-3" />
          </a>{' '}
          — no Google Cloud project needed. Credentials are verified against Gmail before the mailbox is saved.
        </p>
      </CardContent>
    </Card>
  )
}

function EmailTab() {
  const { loading: permsLoading, isAdmin } = usePermissions()
  const canManage = !permsLoading && isAdmin
  const [accounts, setAccounts] = React.useState<EmailAccount[] | null>(null)
  const [open, setOpen] = React.useState(false)
  const [removeTarget, setRemoveTarget] = React.useState<EmailAccount | null>(null)
  const [form, setForm] = React.useState({ provider: 'gmail', emailAddress: '', clientId: '', clientSecret: '', refreshToken: '' })
  const [saving, setSaving] = React.useState(false)
  const [syncingId, setSyncingId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/email/accounts', { cache: 'no-store' })
      const data = await res.json()
      setAccounts(data.accounts ?? [])
    } catch { setAccounts([]) }
  }, [])
  React.useEffect(() => { load() }, [load])

  const connect = async () => {
    if (!form.emailAddress.trim()) { toast.error('Email address is required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/email/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.provider,
          emailAddress: form.emailAddress.trim(),
          credentials: {
            clientId: form.clientId, clientSecret: form.clientSecret, refreshToken: form.refreshToken,
          },
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to connect')
      toast.success(`${form.emailAddress} connected`)
      setOpen(false)
      setForm({ provider: 'gmail', emailAddress: '', clientId: '', clientSecret: '', refreshToken: '' })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to connect')
    } finally { setSaving(false) }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    try {
      const res = await fetch(`/api/email/accounts/${removeTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to disconnect')
      toast.success('Email account disconnected')
      setRemoveTarget(null)
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <div className="space-y-4">
      <GoogleConnectorCard onChanged={load} accounts={accounts} canManage={canManage} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Connected mailboxes</h2>
          <p className="text-xs text-muted-foreground">Each connected address can send and receive email inside the CRM.</p>
          {!permsLoading && !isAdmin && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" /> Connector management is available to Admin users only.
            </p>
          )}
        </div>
        <Button size="sm" className="min-h-9" onClick={() => setOpen(true)} disabled={!canManage} title={canManage ? undefined : 'Admin users only'}>
          <Plus className="mr-1 size-4" /> Connect mailbox
        </Button>
      </div>

      {!accounts ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : accounts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Mail className="size-5" /></div>
            <p className="text-sm font-medium">No mailboxes connected</p>
            <p className="text-xs text-muted-foreground">Connect a Gmail, Outlook or IMAP mailbox to send and sync email.</p>
            {canManage && <Button size="sm" className="mt-2 min-h-9" onClick={() => setOpen(true)}><Plus className="mr-1 size-4" /> Connect mailbox</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Mail className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{a.emailAddress}</p>
                    {a.isActive ? <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3" /> Active</Badge> : <Badge variant="secondary">Paused</Badge>}
                    {a.provider === 'gmail' && a.authMode && (
                      <Badge variant="outline" className="text-[10px]">{a.authMode === 'oauth' ? 'OAuth' : 'App password'}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground capitalize">{a.provider} · sync every {a.syncFrequency}m</p>
                  {a.lastSyncedAt && <p className="text-xs text-muted-foreground">Last synced {new Date(a.lastSyncedAt).toLocaleString()}</p>}
                  {a.lastSyncError && (
                    <p className="mt-1 flex items-start gap-1 text-xs text-destructive"><AlertTriangle className="mt-0.5 size-3 shrink-0" /><span className="min-w-0 break-words">{a.lastSyncError}</span></p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {a.provider === 'gmail' && (
                    <Button size="icon" variant="ghost" disabled={!canManage || syncingId === a.id} title={canManage ? 'Sync now' : 'Admin users only'} onClick={async () => {
                      setSyncingId(a.id)
                      try {
                        const res = await fetch('/api/email/google/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: a.id }) })
                        const data = await res.json().catch(() => null)
                        if (!res.ok) throw new Error(data?.error || 'Sync failed')
                        const r = data?.results?.[0]
                        if (r?.error) toast.warning(`Sync failed: ${r.error}`)
                        else toast.success(`${a.emailAddress}: ${r?.synced ?? 0} new message${(r?.synced ?? 0) === 1 ? '' : 's'}`)
                        load()
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Sync failed')
                      } finally { setSyncingId(null) }
                    }} aria-label={`Sync ${a.emailAddress}`}>
                      {syncingId === a.id ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="text-destructive" disabled={!canManage} title={canManage ? undefined : 'Admin users only'} onClick={() => setRemoveTarget(a)} aria-label="Disconnect"><Trash2 className="size-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SyncedInboxPreview refreshKey={accounts} />

      {/* Connect dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mail className="size-4 text-primary" /> Connect a mailbox</DialogTitle>
            <DialogDescription>OAuth credentials are stored encrypted and never shown again after saving.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
                <SelectContent>{EMAIL_PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="em-addr">Email address <span className="text-destructive">*</span></Label>
              <Input id="em-addr" type="email" value={form.emailAddress} onChange={(e) => setForm({ ...form, emailAddress: e.target.value })} placeholder="you@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="em-client">OAuth Client ID</Label>
              <Input id="em-client" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} placeholder="xxxxx.apps.googleusercontent.com" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="em-secret"><span className="inline-flex items-center gap-1"><KeyRound className="size-3" /> Client secret</span></Label>
                <Input id="em-secret" type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="em-refresh"><span className="inline-flex items-center gap-1"><KeyRound className="size-3" /> Refresh token</span></Label>
                <Input id="em-refresh" type="password" value={form.refreshToken} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={connect} disabled={saving || !form.emailAddress.trim()}>
              {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Plug className="mr-1.5 size-4" />} Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => { if (!o) setRemoveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this mailbox?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{removeTarget?.emailAddress}</span> will stop syncing. Existing emails are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Synced inbox preview (mail pulled from connected mailboxes)
// ---------------------------------------------------------------------------

interface SyncedEmail {
  id: string; fromAddress: string; subject: string; direction: string
  receivedAt: string | null; hasAttachments: boolean
}

function SyncedInboxPreview({ refreshKey }: { refreshKey: unknown }) {
  const [emails, setEmails] = React.useState<SyncedEmail[] | null>(null)

  React.useEffect(() => {
    fetch('/api/email/messages', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { emails: [] }))
      .then((d) => setEmails((d?.emails ?? []) as SyncedEmail[]))
      .catch(() => setEmails([]))
  }, [refreshKey])

  const inbound = (emails ?? []).filter((e) => e.direction === 'inbound').slice(0, 12)

  return (
    <div>
      <div className="flex items-center gap-2">
        <Inbox className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Synced inbox</h2>
        <span className="text-xs text-muted-foreground">· latest mail pulled from connected mailboxes</span>
      </div>
      {!emails ? (
        <div className="mt-2 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : inbound.length === 0 ? (
        <Card className="mt-2 border-dashed">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">No synced mail yet — connect a Gmail mailbox above and hit “Sync now”.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-2">
          <CardContent className="p-0">
            <ul className="max-h-96 divide-y overflow-y-auto">
              {inbound.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Mail className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.subject}</p>
                    <p className="truncate text-xs text-muted-foreground">{e.fromAddress}</p>
                  </div>
                  {e.hasAttachments && <Badge variant="outline" className="shrink-0 text-[10px]">attachment</Badge>}
                  {e.receivedAt && <span className="shrink-0 text-xs text-muted-foreground">{new Date(e.receivedAt).toLocaleString()}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WhatsApp live connector — the UI now lives in `../wa-chat-list.tsx`
// (hooks + step-by-step connector card + chat list/conversation experience).
// ROUTING: calls go through the additive Next proxy
// `/api/whatsapp/live/*` → 127.0.0.1:3010 (src/app/api/whatsapp/live). This
// works from EVERY context: the Caddy gateway preview (`?XTransformPort=3010`
// would only work there) AND a direct :3000 origin. Relative URL only —
// never absolute URLs or :ports there.
// ---------------------------------------------------------------------------

function WhatsAppTab() {
  const { loading: permsLoading, isAdmin } = usePermissions()
  const wa = useWaConnector()
  const connected = wa.status?.status === 'connected'
  // FIX 3.9 preserve-on-reconnect: once connected, keep the chat experience
  // mounted across disconnect↔reconnect flips (it shows a subtle
  // "Reconnecting…" bar instead of unmounting / clearing).
  const [everConnected, setEverConnected] = React.useState(false)
  React.useEffect(() => { if (connected) setEverConnected(true) }, [connected])
  const chats = useWaChats(Boolean(isAdmin && connected))
  const chatsRef = React.useRef<HTMLDivElement | null>(null)
  const canManage = !permsLoading && isAdmin

  const [accounts, setAccounts] = React.useState<WhatsAppAccount[] | null>(null)
  const [open, setOpen] = React.useState(false)
  const [removeTarget, setRemoveTarget] = React.useState<WhatsAppAccount | null>(null)
  const [form, setForm] = React.useState({
    displayName: '', displayPhoneNumber: '', wabaId: '', phoneNumberId: '', accessToken: '',
  })
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/accounts', { cache: 'no-store' })
      const data = await res.json()
      setAccounts(data.accounts ?? [])
    } catch { setAccounts([]) }
  }, [])
  React.useEffect(() => { load() }, [load])

  const connect = async () => {
    if (!form.displayName.trim() || !form.displayPhoneNumber.trim() || !form.wabaId.trim() || !form.phoneNumberId.trim() || !form.accessToken.trim()) {
      toast.error('All fields are required'); return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/whatsapp/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to connect')
      toast.success(`WhatsApp ${form.displayPhoneNumber} connected`)
      setOpen(false)
      setForm({ displayName: '', displayPhoneNumber: '', wabaId: '', phoneNumberId: '', accessToken: '' })
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    try {
      const res = await fetch(`/api/whatsapp/accounts/${removeTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to disconnect')
      toast.success('WhatsApp account disconnected')
      setRemoveTarget(null)
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <div className="space-y-4">
      {/* Live connector (mini-service) — Admin-gated */}
      {permsLoading ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-4 w-80" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-9 w-44" />
          </CardContent>
        </Card>
      ) : !isAdmin ? (
        <WaLockedCard status={wa.status} unreachable={wa.unreachable} />
      ) : (
        <>
          <WaConnectorCard
            wa={wa}
            chats={chats}
            onOpenChats={() => chatsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
          {(everConnected || connected) && (
            <div ref={chatsRef} className="scroll-mt-4">
              <WaChatExperience wa={wa} chats={chats} mode={wa.status?.mode} />
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">WhatsApp Business accounts</h2>
          <p className="text-xs text-muted-foreground">Connect a WABA (WhatsApp Business Account) to send templated and session messages.</p>
          {!permsLoading && !isAdmin && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" /> Connector management is available to Admin users only — shown read-only.
            </p>
          )}
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)}><Plus className="mr-1 size-4" /> Connect WABA</Button>
        )}
      </div>

      {!accounts ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : accounts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"><MessageCircle className="size-5" /></div>
            <p className="text-sm font-medium">No WhatsApp accounts connected</p>
            <p className="text-xs text-muted-foreground">Connect your WhatsApp Business Account to send messages from the CRM.</p>
            {canManage && <Button className="mt-2" onClick={() => setOpen(true)}><Plus className="mr-1 size-4" /> Connect WABA</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600"><MessageCircle className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{a.displayName}</p>
                    {a.isVerified
                      ? <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"><ShieldCheck className="size-3" /> Verified</Badge>
                      : <Badge variant="secondary">Pending</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{a.displayPhoneNumber}</p>
                  <p className="text-xs text-muted-foreground">WABA {a.wabaId} · quality {a.qualityRating}</p>
                </div>
                <Button size="icon" variant="ghost" className="text-destructive" disabled={!canManage} title={canManage ? undefined : 'Admin users only'} onClick={() => setRemoveTarget(a)} aria-label="Disconnect"><Trash2 className="size-4" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MessageCircle className="size-4 text-emerald-600" /> Connect WhatsApp Business</DialogTitle>
            <DialogDescription>Enter your WhatsApp Business API credentials from Meta for Developers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wa-name">Display name <span className="text-destructive">*</span></Label>
                <Input id="wa-name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Sales Line" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-phone">Phone number <span className="text-destructive">*</span></Label>
                <Input id="wa-phone" value={form.displayPhoneNumber} onChange={(e) => setForm({ ...form, displayPhoneNumber: e.target.value })} placeholder="+91 98765 43210" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wa-waba">WABA ID <span className="text-destructive">*</span></Label>
                <Input id="wa-waba" value={form.wabaId} onChange={(e) => setForm({ ...form, wabaId: e.target.value })} placeholder="1029384756" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-pnid">Phone Number ID <span className="text-destructive">*</span></Label>
                <Input id="wa-pnid" value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} placeholder="1098765432" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-token"><span className="inline-flex items-center gap-1"><KeyRound className="size-3" /> Access token <span className="text-destructive">*</span></span></Label>
              <Input id="wa-token" type="password" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} placeholder="EAAG…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={connect} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Plug className="mr-1.5 size-4" />} Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => { if (!o) setRemoveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this WhatsApp account?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{removeTarget?.displayName}</span> ({removeTarget?.displayPhoneNumber}) will stop sending and receiving.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phone numbers tab
// ---------------------------------------------------------------------------

const PHONE_PROVIDERS = [
  { value: 'twilio', label: 'Twilio' },
  { value: 'exotel', label: 'Exotel' },
  { value: 'vonage', label: 'Vonage' },
  { value: 'plivo', label: 'Plivo' },
  { value: 'msg91', label: 'MSG91' },
]

function PhoneTab() {
  const [numbers, setNumbers] = React.useState<PhoneNumber[] | null>(null)
  const [open, setOpen] = React.useState(false)
  const [removeTarget, setRemoveTarget] = React.useState<PhoneNumber | null>(null)
  const [form, setForm] = React.useState({
    number: '', provider: 'twilio', friendlyName: '', region: 'IN',
    voice: true, sms: true, whatsapp: false,
  })
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/telephony/numbers', { cache: 'no-store' })
      const data = await res.json()
      setNumbers(data.numbers ?? [])
    } catch { setNumbers([]) }
  }, [])
  React.useEffect(() => { load() }, [load])

  const provision = async () => {
    if (!form.number.trim()) { toast.error('Phone number is required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/telephony/numbers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: form.number.trim(), provider: form.provider, friendlyName: form.friendlyName.trim() || undefined,
          region: form.region, capabilities: { voice: form.voice, sms: form.sms, whatsapp: form.whatsapp },
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to provision')
      toast.success(`${form.number} provisioned`)
      setOpen(false)
      setForm({ number: '', provider: 'twilio', friendlyName: '', region: 'IN', voice: true, sms: true, whatsapp: false })
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    try {
      const res = await fetch(`/api/telephony/numbers/${removeTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to release')
      toast.success('Number released')
      setRemoveTarget(null)
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  const parseCaps = (raw: string): { voice?: boolean; sms?: boolean; mms?: boolean; whatsapp?: boolean } => {
    try { return JSON.parse(raw) } catch { return {} }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Provisioned phone numbers</h2>
          <p className="text-xs text-muted-foreground">Numbers your team can dial and SMS from. Voice, SMS and WhatsApp-capable numbers show badges.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 size-4" /> Provision number</Button>
      </div>

      {!numbers ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : numbers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Phone className="size-5" /></div>
            <p className="text-sm font-medium">No numbers provisioned</p>
            <p className="text-xs text-muted-foreground">Provision a number with your telephony provider to start making calls.</p>
            <Button size="sm" className="mt-2" onClick={() => setOpen(true)}><Plus className="mr-1 size-4" /> Provision number</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {numbers.map((n) => {
            const caps = parseCaps(n.capabilities)
            return (
              <Card key={n.id}>
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Phone className="size-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm font-medium">{n.number}</p>
                      {n.isActive ? <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3" /> Active</Badge> : <Badge variant="secondary">Released</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground capitalize">{n.provider} · {n.region} {n.friendlyName && n.friendlyName !== n.number ? `· ${n.friendlyName}` : ''}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {caps.voice && <Badge variant="outline" className="text-[10px]">Voice</Badge>}
                      {caps.sms && <Badge variant="outline" className="text-[10px]">SMS</Badge>}
                      {caps.whatsapp && <Badge variant="outline" className="text-[10px]">WhatsApp</Badge>}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setRemoveTarget(n)} aria-label="Release"><Trash2 className="size-4" /></Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Phone className="size-4 text-primary" /> Provision a phone number</DialogTitle>
            <DialogDescription>Register a number you already own with your telephony provider.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pn-num">Number <span className="text-destructive">*</span></Label>
                <Input id="pn-num" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="+91 98765 43210" />
              </div>
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                  <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
                  <SelectContent>{PHONE_PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pn-name">Friendly name</Label>
                <Input id="pn-name" value={form.friendlyName} onChange={(e) => setForm({ ...form, friendlyName: e.target.value })} placeholder="Sales line" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pn-region">Region</Label>
                <Input id="pn-region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="IN" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Capabilities</Label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm"><Switch checked={form.voice} onCheckedChange={(v) => setForm({ ...form, voice: v })} /> Voice</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={form.sms} onCheckedChange={(v) => setForm({ ...form, sms: v })} /> SMS</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={form.whatsapp} onCheckedChange={(v) => setForm({ ...form, whatsapp: v })} /> WhatsApp</label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={provision} disabled={saving || !form.number.trim()}>
              {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Plus className="mr-1.5 size-4" />} Provision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => { if (!o) setRemoveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release this number?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono font-medium text-foreground">{removeTarget?.number}</span> will be marked inactive. Re-provision to use it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Release</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Integrations tab
// ---------------------------------------------------------------------------

function IntegrationsTab() {
  const [catalog, setCatalog] = React.useState<IntegrationDef[] | null>(null)
  const [connected, setConnected] = React.useState<IntegrationRow[] | null>(null)
  const [openProvider, setOpenProvider] = React.useState<IntegrationDef | null>(null)
  const [formValues, setFormValues] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/channels/integrations?catalog=true', { cache: 'no-store' })
      const data = await res.json()
      setCatalog(data.catalog ?? [])
      setConnected(data.integrations ?? [])
    } catch { setCatalog([]); setConnected([]) }
  }, [])
  React.useEffect(() => { load() }, [load])

  const openConnect = (def: IntegrationDef) => {
    setOpenProvider(def)
    const init: Record<string, string> = {}
    for (const f of def.fields) init[f.key] = ''
    setFormValues(init)
  }

  const connect = async () => {
    if (!openProvider) return
    setSaving(true)
    try {
      const res = await fetch('/api/channels/integrations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: openProvider.provider, config: formValues }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to connect')
      toast.success(`${openProvider.name} connected`)
      setOpenProvider(null)
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  const disconnect = async (provider: string, name: string) => {
    try {
      const res = await fetch('/api/channels/integrations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, action: 'disconnect' }),
      })
      if (!res.ok) throw new Error('Failed to disconnect')
      toast.success(`${name} disconnected`)
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  const connectedMap = React.useMemo(() => {
    const m = new Map<string, IntegrationRow>()
    for (const i of connected ?? []) m.set(i.provider, i)
    return m
  }, [connected])

  // Group catalog by category
  const byCategory = React.useMemo(() => {
    const m = new Map<string, IntegrationDef[]>()
    for (const def of catalog ?? []) {
      const arr = m.get(def.category) ?? []
      arr.push(def)
      m.set(def.category, arr)
    }
    return Array.from(m.entries())
  }, [catalog])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Third-party integrations</h2>
          <p className="text-xs text-muted-foreground">Connect payment, telephony, notification and meeting providers. Credentials are stored encrypted.</p>
        </div>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="mr-1 size-4" /> Refresh</Button>
      </div>

      {!catalog ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : byCategory.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">No integrations available.</CardContent></Card>
      ) : (
        <div className="space-y-5">
          {byCategory.map(([category, defs]) => (
            <div key={category}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {defs.map((def) => {
                  const row = connectedMap.get(def.provider)
                  const isConnected = !!row?.isConnected
                  return (
                    <Card key={def.provider} className={isConnected ? 'border-emerald-500/40' : ''}>
                      <CardContent className="flex h-full flex-col p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{def.name}</p>
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{def.description}</p>
                          </div>
                          {isConnected
                            ? <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3" /> Connected</Badge>
                            : <Badge variant="secondary">Not connected</Badge>}
                        </div>
                        <div className="mt-3 flex justify-end">
                          {isConnected ? (
                            <Button size="sm" variant="outline" className="text-destructive" onClick={() => disconnect(def.provider, def.name)}>
                              <XCircle className="mr-1 size-3.5" /> Disconnect
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => openConnect(def)}>
                              <Plug className="mr-1 size-3.5" /> Connect <ChevronRight className="ml-0.5 size-3" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Connect dialog */}
      <Dialog open={!!openProvider} onOpenChange={(o) => { if (!o) setOpenProvider(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plug className="size-4 text-primary" /> Connect {openProvider?.name}</DialogTitle>
            <DialogDescription>{openProvider?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {openProvider?.fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`int-${f.key}`}>
                  {f.label} {f.required && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id={`int-${f.key}`}
                  type={f.type === 'password' ? 'password' : 'text'}
                  value={formValues[f.key] ?? ''}
                  onChange={(e) => setFormValues((cur) => ({ ...cur, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenProvider(null)} disabled={saving}>Cancel</Button>
            <Button onClick={connect} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Plug className="mr-1.5 size-4" />} Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
