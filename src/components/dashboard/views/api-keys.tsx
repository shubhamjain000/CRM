'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  KeyRound, Plus, Copy, Check, Ban, Plug, RefreshCw,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiKeyRow {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  ownerName: string
  isOwn: boolean
}

interface CreatedKey {
  id: string
  key: string
  name: string
  keyPrefix: string
  scopes: string[]
}

type KeyStatus = 'active' | 'expired' | 'revoked'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusOf(row: ApiKeyRow): KeyStatus {
  if (row.revokedAt) return 'revoked'
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return 'expired'
  return 'active'
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return ''
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return new Date(iso).toLocaleDateString()
}

/** Clipboard write with execCommand fallback for non-secure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

const SCROLLBAR_CLASS =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent'

/** Copy-to-clipboard button that flips to a check mark briefly. */
function CopyButton({ text, label, small }: { text: string; label: string; small?: boolean }) {
  const t = useTranslations()
  const [copied, setCopied] = React.useState(false)

  const onCopy = async () => {
    const ok = await copyText(text)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error(t('apiKeys.copyFailed'))
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={small ? 'sm' : 'default'}
      onClick={() => void onCopy()}
      aria-label={label}
    >
      {copied ? <Check className="size-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-4" />}
      <span className="ml-1.5">{copied ? t('apiKeys.copied') : t('apiKeys.copy')}</span>
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ApiKeysView() {
  const t = useTranslations()
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([])
  const [isAdmin, setIsAdmin] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')

  const [createOpen, setCreateOpen] = React.useState(false)
  const [revokeTarget, setRevokeTarget] = React.useState<ApiKeyRow | null>(null)
  const [revoking, setRevoking] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/settings/api-keys', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || t('apiKeys.loadFailed'))
      setKeys(Array.isArray(data?.keys) ? data.keys : [])
      setIsAdmin(!!data?.isAdmin)
    } catch (e) {
      const message = e instanceof Error ? e.message : t('apiKeys.loadFailed')
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => { void load() }, [load])

  const confirmRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      const res = await fetch(`/api/settings/api-keys/${encodeURIComponent(revokeTarget.id)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || t('apiKeys.loadFailed'))
      toast.success(t('apiKeys.revoked'))
      setRevokeTarget(null)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('apiKeys.loadFailed'))
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('apiKeys.title')}</h1>
          <p className="text-muted-foreground">{t('apiKeys.description')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus className="mr-1.5 size-4" /> {t('apiKeys.createKey')}
        </Button>
      </div>

      {/* Your API keys */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">{t('apiKeys.yourKeys')}</CardTitle>
              <CardDescription>{isAdmin ? t('apiKeys.yourKeysDescAdmin') : t('apiKeys.yourKeysDesc')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2" role="status" aria-label={t('common.loading')}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : error && keys.length === 0 ? (
            <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-destructive" role="alert">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="mr-1.5 size-3.5" /> {t('common.retry')}
              </Button>
            </div>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('apiKeys.empty')}</p>
          ) : (
            <ul className={`max-h-96 space-y-2 overflow-y-auto pr-1 ${SCROLLBAR_CLASS}`}>
              {keys.map((row) => {
                const status = statusOf(row)
                const canRevoke = status === 'active' && (row.isOwn || isAdmin)
                return (
                  <li key={row.id} className="flex flex-col gap-2 rounded-lg border p-3 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate text-sm font-medium">{row.name}</span>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {row.keyPrefix}…
                          </code>
                          {row.scopes.includes('write') ? (
                            <Badge variant="default">{t('apiKeys.scopeWrite')}</Badge>
                          ) : (
                            <Badge variant="secondary">{t('apiKeys.scopeRead')}</Badge>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span>{t('apiKeys.created')}: {new Date(row.createdAt).toLocaleDateString()}</span>
                          <span>
                            {t('apiKeys.lastUsed')}: {row.lastUsedAt ? timeAgo(row.lastUsedAt) : t('apiKeys.never')}
                          </span>
                          <span className="truncate">{t('apiKeys.owner')}: {row.ownerName}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
                      <StatusBadge status={status} />
                      {canRevoke && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`${t('apiKeys.revoke')} — ${row.name}`}
                          onClick={() => setRevokeTarget(row)}
                        >
                          <Ban className="size-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <DocsCard />

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void load()}
      />

      {/* Revoke confirmation */}
      <Dialog open={!!revokeTarget} onOpenChange={(v) => { if (!v) setRevokeTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="size-4 text-destructive" /> {t('apiKeys.revokeTitle')}
            </DialogTitle>
            <DialogDescription>
              {revokeTarget ? t('apiKeys.revokeDesc', { name: revokeTarget.name }) : ''}
            </DialogDescription>
          </DialogHeader>
          {revokeTarget && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{revokeTarget.name}</span>
              <code className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {revokeTarget.keyPrefix}…
              </code>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)} disabled={revoking}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmRevoke} disabled={revoking}>
              <Ban className="mr-2 size-4" /> {revoking ? t('common.loading') : t('apiKeys.revoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatusBadge({ status }: { status: KeyStatus }) {
  const t = useTranslations()
  if (status === 'active') {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
        {t('apiKeys.active')}
      </Badge>
    )
  }
  if (status === 'expired') {
    return (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        {t('apiKeys.expired')}
      </Badge>
    )
  }
  return <Badge variant="secondary">{t('apiKeys.statusRevoked')}</Badge>
}

// ---------------------------------------------------------------------------
// Create dialog — form → "shown once" key panel
// ---------------------------------------------------------------------------

function CreateKeyDialog({ open, onOpenChange, onCreated }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
}) {
  const t = useTranslations()
  const [name, setName] = React.useState('')
  const [scope, setScope] = React.useState<'read' | 'write'>('read')
  const [expiry, setExpiry] = React.useState<'never' | '30' | '60' | '90'>('never')
  const [creating, setCreating] = React.useState(false)
  const [createdKey, setCreatedKey] = React.useState<CreatedKey | null>(null)

  const reset = () => {
    setName('')
    setScope('read')
    setExpiry('never')
    setCreatedKey(null)
    setCreating(false)
  }

  const close = (v: boolean) => {
    onOpenChange(v)
    if (!v) reset()
  }

  const submit = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          scope,
          expiresInDays: expiry === 'never' ? undefined : Number(expiry),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || t('apiKeys.loadFailed'))
      setCreatedKey(data as CreatedKey)
      toast.success(t('apiKeys.keyCreated'))
      onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('apiKeys.loadFailed'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        {createdKey ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-emerald-600 dark:text-emerald-400" /> {t('apiKeys.keyCreated')}
              </DialogTitle>
              <DialogDescription>{createdKey.name}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-700 dark:text-amber-300">{t('apiKeys.keyShownOnce')}</p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3">
                <code className="block break-all font-mono text-sm">{createdKey.key}</code>
              </div>
              <CopyButton text={createdKey.key} label={t('apiKeys.copy')} />
            </div>
            <DialogFooter>
              <Button onClick={() => close(false)}>{t('apiKeys.done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('apiKeys.createKey')}</DialogTitle>
              <DialogDescription>{t('apiKeys.createDesc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="api-key-name">{t('apiKeys.keyName')}</Label>
                <Input
                  id="api-key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('apiKeys.keyNamePlaceholder')}
                  maxLength={80}
                />
              </div>

              <div className="space-y-1.5">
                <Label>{t('apiKeys.scope')}</Label>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('apiKeys.scope')}>
                  {([
                    { value: 'read', label: t('apiKeys.scopeRead'), desc: t('apiKeys.scopeReadDesc') },
                    { value: 'write', label: t('apiKeys.scopeWrite'), desc: t('apiKeys.scopeWriteDesc') },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={scope === opt.value}
                      onClick={() => setScope(opt.value)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        scope === opt.value
                          ? 'border-emerald-500/60 bg-emerald-500/5'
                          : 'hover:bg-muted/40'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {opt.label}
                        {scope === opt.value && <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t('apiKeys.expiry')}</Label>
                <Select value={expiry} onValueChange={(v) => setExpiry(v as 'never' | '30' | '60' | '90')}>
                  <SelectTrigger aria-label={t('apiKeys.expiry')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">{t('apiKeys.expiryNever')}</SelectItem>
                    <SelectItem value="30">{t('apiKeys.expiry30')}</SelectItem>
                    <SelectItem value="60">{t('apiKeys.expiry60')}</SelectItem>
                    <SelectItem value="90">{t('apiKeys.expiry90')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)} disabled={creating}>
                {t('common.cancel')}
              </Button>
              <Button onClick={submit} disabled={creating || name.trim().length === 0}>
                {creating ? t('common.loading') : t('apiKeys.createKey')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// BI connection docs
// ---------------------------------------------------------------------------

function DocsCard() {
  const t = useTranslations()
  // Computed after mount to avoid hydration mismatch with SSR.
  const [origin, setOrigin] = React.useState('')
  React.useEffect(() => { setOrigin(window.location.origin) }, [])

  const baseUrl = `${origin || '…'}/api/public/v1`

  const endpoints = [
    { method: 'GET', path: '/ping', scope: 'read', desc: t('apiKeys.epPing') },
    { method: 'GET', path: '/contacts', scope: 'read', desc: t('apiKeys.epContactsList') },
    { method: 'GET', path: '/contacts/{id}', scope: 'read', desc: t('apiKeys.epContactsGet') },
    { method: 'POST', path: '/contacts', scope: 'write', desc: t('apiKeys.epContactsCreate') },
    { method: 'GET', path: '/leads', scope: 'read', desc: t('apiKeys.epLeads') },
    { method: 'GET', path: '/deals', scope: 'read', desc: t('apiKeys.epDeals') },
  ]

  const curlList = `curl -H "X-API-Key: YOUR_KEY" "${baseUrl}/contacts?limit=100"`
  const curlIncremental = `curl -H "X-API-Key: YOUR_KEY" "${baseUrl}/contacts?modified_since=2024-06-01T00:00:00Z"`

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Plug className="size-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">{t('apiKeys.docsTitle')}</CardTitle>
            <CardDescription>{t('apiKeys.docsIntro')}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Base URL */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('apiKeys.baseUrl')}</p>
          <code className="block break-all rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm">
            {baseUrl}
          </code>
        </div>

        {/* Auth headers */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('apiKeys.authHeader')}</p>
          <div className="space-y-1 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs">
            <p className="break-all">X-API-Key: &lt;your key&gt;</p>
            <p className="break-all text-muted-foreground">Authorization: Bearer &lt;your key&gt;</p>
          </div>
        </div>

        {/* Endpoints */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('apiKeys.endpoints')}</p>
          <div className="max-h-96 overflow-y-auto rounded-lg border [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60">
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('apiKeys.method')}</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('apiKeys.endpoint')}</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('apiKeys.scopeCol')}</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('apiKeys.descriptionCol')}</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((ep, i) => (
                  <tr key={ep.method + ep.path} className={i % 2 === 1 ? 'bg-muted/30' : undefined}>
                    <td className="px-3 py-1.5">
                      <Badge
                        variant="outline"
                        className={
                          ep.method === 'POST'
                            ? 'border-amber-500/50 text-amber-700 dark:text-amber-400'
                            : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                        }
                      >
                        {ep.method}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{ep.path}</td>
                    <td className="px-3 py-1.5">
                      {ep.scope === 'write'
                        ? <Badge variant="default">{t('apiKeys.scopeWrite')}</Badge>
                        : <Badge variant="secondary">{t('apiKeys.scopeRead')}</Badge>}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{ep.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination + incremental sync notes */}
        <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p><span className="font-medium text-foreground">{t('apiKeys.pagination')}</span> {t('apiKeys.paginationDesc')}</p>
          <p><span className="font-medium text-foreground">{t('apiKeys.incremental')}</span> {t('apiKeys.incrementalDesc')}</p>
        </div>

        {/* curl examples */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('apiKeys.curlExample')}</p>
          {[curlList, curlIncremental].map((cmd) => (
            <div key={cmd} className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center">
              <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">{cmd}</pre>
              <CopyButton text={cmd} label={t('apiKeys.copy')} small />
            </div>
          ))}
        </div>

        {/* BI tool guidance */}
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('apiKeys.biGuide')}</p>
          <p className="text-sm text-muted-foreground">{t('apiKeys.biGuideBody')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
