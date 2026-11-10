'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { startRegistration } from '@simplewebauthn/browser'
import { QRCodeSVG } from 'qrcode.react'
import { ShieldCheck, Fingerprint, Plus, KeyRound, CheckCircle2, XCircle, Lock, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useAuth, type SessionPasskey } from '@/store/auth'
import { toast } from 'sonner'

export function SecurityView() {
  const t = useTranslations()
  const { user, fetchMe, passkeys } = useAuth()
  const [totpOpen, setTotpOpen] = React.useState(false)
  const [passkeyOpen, setPasskeyOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<SessionPasskey | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/auth/passkey/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to delete passkey')
      toast.success(t('security.passkeyDeleted'))
      setDeleteTarget(null)
      fetchMe()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete passkey')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('security.title')}</h1>
        <p className="text-muted-foreground">Manage your authentication factors</p>
      </div>

      {/* 2FA */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">{t('security.twoFactor')}</CardTitle>
                <CardDescription>Authenticator-app based (TOTP)</CardDescription>
              </div>
            </div>
            {user?.is2faEnabled ? (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="mr-1 size-3" /> {t('security.twoFactorEnabled')}
              </Badge>
            ) : (
              <Badge variant="outline">
                <XCircle className="mr-1 size-3" /> {t('security.twoFactorDisabled')}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {user?.is2faEnabled ? (
            <Button variant="outline" onClick={async () => {
              const res = await fetch('/api/auth/2fa/disable', { method: 'POST' })
              if (res.ok) { toast.success('2FA disabled'); fetchMe() }
            }}>
              {t('security.disable2FA')}
            </Button>
          ) : (
            <Button onClick={() => setTotpOpen(true)}>
              <ShieldCheck className="mr-2 size-4" /> {t('security.enable2FA')}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Passkeys */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Fingerprint className="size-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">{t('security.passkeys')}</CardTitle>
                <CardDescription>WebAuthn / passwordless login</CardDescription>
              </div>
            </div>
            <Button size="sm" onClick={() => setPasskeyOpen(true)}>
              <Plus className="mr-1.5 size-4" /> {t('security.addPasskey')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {passkeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('security.noPasskeys')}</p>
          ) : (
            <ul className="space-y-2">
              {passkeys.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-sm">{p.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`${t('security.deletePasskey')} — ${p.name}`}
                    onClick={() => setDeleteTarget(p)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <TwoFactorDialog open={totpOpen} onOpenChange={setTotpOpen} onDone={fetchMe} />
      <PasskeyDialog open={passkeyOpen} onOpenChange={setPasskeyOpen} onDone={fetchMe} />

      {/* Delete-passkey confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-4 text-destructive" /> {t('security.deletePasskey')}
            </DialogTitle>
            <DialogDescription>{t('security.deletePasskeyDesc')}</DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{deleteTarget.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {new Date(deleteTarget.createdAt).toLocaleDateString()}
              </span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              <Trash2 className="mr-2 size-4" /> {deleting ? t('common.loading') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FieldSecurityCard />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field-level security — per-role field visibility/write matrix (Tier 3)
// ---------------------------------------------------------------------------

const FIELD_MODELS = [
  { value: 'lead', label: 'Leads' },
  { value: 'contact', label: 'Contacts' },
  { value: 'account', label: 'Accounts' },
  { value: 'deal', label: 'Deals' },
] as const

const FIELD_LEVELS = [
  { value: 'visible', label: 'Visible' },
  { value: 'read_only', label: 'Read only' },
  { value: 'hidden', label: 'Hidden' },
] as const

/** Cell color coding: default / amber (read only) / destructive (hidden). */
function levelClasses(level: string): string {
  if (level === 'read_only') return 'border-amber-500/50 text-amber-700 dark:text-amber-400'
  if (level === 'hidden') return 'border-destructive/50 text-destructive'
  return ''
}

function humanizeField(f: string): string {
  const LABELS: Record<string, string> = {
    emails: 'Emails', phones: 'Phones', ownerId: 'Owner', stageId: 'Stage',
    closeDate: 'Close date', nextStep: 'Next step', accountId: 'Account',
    leadStatus: 'Lead status', leadSource: 'Lead source', annualRevenue: 'Annual revenue',
  }
  return LABELS[f] ?? f.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

function FieldSecurityCard() {
  const [roles, setRoles] = React.useState<{ id: string; name: string }[]>([])
  const [model, setModel] = React.useState<string>('lead')
  /** roleId → model → field → level */
  const [rules, setRules] = React.useState<Record<string, Record<string, Record<string, string>>>>({})
  const [catalog, setCatalog] = React.useState<Record<string, string[]>>({})
  const [canManage, setCanManage] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')

  /** Flatten a GET ?roleId= response into the matrix slice for that role. */
  const rulesFor = (d: { rules?: { model: string; field: string; level: string }[] }) => {
    const perModel: Record<string, Record<string, string>> = {}
    for (const rule of d.rules ?? []) {
      perModel[rule.model] = perModel[rule.model] ?? {}
      perModel[rule.model][rule.field] = rule.level
    }
    return perModel
  }

  const load = React.useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Own role first (works for admins and non-admins alike).
      const ownRes = await fetch('/api/security/field-security', { cache: 'no-store' })
      const own = await ownRes.json()
      if (!ownRes.ok) throw new Error(own?.error || 'Failed to load field rules')
      setCatalog(own.catalog ?? {})
      setCanManage(!!own.canManage)
      const map: Record<string, Record<string, Record<string, string>>> = {
        [own.role.id]: rulesFor(own),
      }
      let columns: { id: string; name: string }[] = [own.role]
      if (own.canManage) {
        // Admins see the FULL matrix: one column per org role. Other roles load
        // in parallel; a failed column degrades to 'visible' (no rules shown).
        const rolesRes = await fetch('/api/roles', { cache: 'no-store' })
        const rolesData = await rolesRes.json()
        const orgRoles: { id: string; name: string }[] = (rolesData.roles ?? [])
          .map((r: { id: string; name: string }) => ({ id: r.id, name: r.name }))
        columns = orgRoles.length > 0 ? orgRoles : [own.role]
        const others = columns.filter((r) => r.id !== own.role.id)
        const results = await Promise.allSettled(
          others.map((r) =>
            fetch(`/api/security/field-security?roleId=${encodeURIComponent(r.id)}`, { cache: 'no-store' })
              .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load failed')))),
          ),
        )
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') map[others[i].id] = rulesFor(r.value)
        })
      }
      setRoles(columns)
      setRules(map)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load field rules')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  /** Optimistic per-cell save — same POST contract as before. */
  const setLevel = async (roleId: string, field: string, level: string) => {
    if (!canManage) return
    const prev = rules[roleId]?.[model]?.[field] ?? 'visible'
    setRules((m) => ({
      ...m,
      [roleId]: {
        ...(m[roleId] ?? {}),
        [model]: { ...(m[roleId]?.[model] ?? {}), [field]: level },
      },
    }))
    try {
      const res = await fetch('/api/security/field-security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId, model, field, level }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        throw new Error(d?.error || 'Failed to update field rule')
      }
      toast.success(level === 'visible' ? `${humanizeField(field)} is visible again` : `${humanizeField(field)} set to ${FIELD_LEVELS.find((l) => l.value === level)?.label}`)
    } catch (e) {
      setRules((m) => ({
        ...m,
        [roleId]: {
          ...(m[roleId] ?? {}),
          [model]: { ...(m[roleId]?.[model] ?? {}), [field]: prev },
        },
      }))
      toast.error(e instanceof Error ? e.message : 'Failed to update field rule')
    }
  }

  const fields = catalog[model] ?? []
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="size-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Field security</CardTitle>
              <CardDescription>
                Rows are fields, columns are roles — hidden fields are removed from lists, details and exports; read-only fields cannot be edited.
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="h-9 w-40" aria-label="Module">
              <SelectValue placeholder="Module" />
            </SelectTrigger>
            <SelectContent>
              {FIELD_MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-1.5" aria-hidden>
            <Badge variant="outline">Visible</Badge>
            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">Read only</Badge>
            <Badge variant="outline" className="border-destructive/50 text-destructive">Hidden</Badge>
          </div>
          {!canManage && !loading && (
            <span className="text-xs text-muted-foreground">Showing your role — only organization admins can change these rules.</span>
          )}
        </div>

        {loading ? (
          <div className="space-y-2" role="status" aria-label="Loading field security matrix">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-destructive" role="alert">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </div>
        ) : fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fields configured for this module.</p>
        ) : (
          <div className="relative">
            {/* Horizontal scroll on narrow screens so many roles never break the
                layout; edge fades hint there is more to scroll on mobile. */}
            <div className="max-h-96 overflow-x-auto overflow-y-auto rounded-md border">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-muted/95 backdrop-blur">
                    <th scope="col" className="sticky left-0 z-30 bg-muted px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Field
                    </th>
                    {roles.map((r) => (
                      <th key={r.id} scope="col" className="px-2 py-2 text-left text-xs font-semibold">
                        {r.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, i) => (
                    <tr key={f} className={i % 2 === 1 ? 'bg-muted/30' : undefined}>
                      <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-1.5 text-left text-sm font-medium">
                        {humanizeField(f)}
                      </th>
                      {roles.map((r) => {
                        const level = rules[r.id]?.[model]?.[f] ?? 'visible'
                        return (
                          <td key={r.id} className="px-2 py-1.5">
                            <Select value={level} onValueChange={(v) => void setLevel(r.id, f, v)} disabled={!canManage}>
                              <SelectTrigger
                                className={`h-7 w-28 text-xs ${levelClasses(level)}`}
                                aria-label={`${r.name} — access level for ${humanizeField(f)}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FIELD_LEVELS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Subtle mobile edge fades over the horizontal scroll area */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent sm:hidden" aria-hidden />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent sm:hidden" aria-hidden />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TwoFactorDialog({ open, onOpenChange, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void
}) {
  const t = useTranslations()
  const [secret, setSecret] = React.useState('')
  const [uri, setUri] = React.useState('')
  const [code, setCode] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      fetch('/api/auth/2fa/setup', { method: 'POST' })
        .then((r) => r.json())
        .then((d) => { setSecret(d.secret); setUri(d.uri) })
        .catch(() => toast.error('Failed to start 2FA setup'))
    }
  }, [open])

  const verify = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Invalid code')
      toast.success('2FA enabled')
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('security.enable2FA')}</DialogTitle>
          <DialogDescription>{t('auth.twoFactorPrompt')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 p-4">
            {uri ? (
              <div className="rounded-lg bg-white p-3 shadow-sm" role="img" aria-label="Scan this QR code with your authenticator app">
                <QRCodeSVG value={uri} size={168} level="M" includeMargin={false} />
              </div>
            ) : (
              <div className="flex h-[192px] w-[192px] items-center justify-center rounded-lg bg-white p-3 text-xs text-muted-foreground">
                Loading QR…
              </div>
            )}
            <p className="text-center text-xs text-muted-foreground">
              Scan this QR in your authenticator app (Authy, 1Password, Google Authenticator).
            </p>
            <p className="break-all font-mono text-[10px] text-muted-foreground/70">{uri}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="totp-code">6-digit code</Label>
            <Input id="totp-code" inputMode="numeric" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={verify} disabled={loading || code.length !== 6}>
            {loading ? t('common.loading') : t('auth.verify')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PasskeyDialog({ open, onOpenChange, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void
}) {
  const t = useTranslations()
  const [name, setName] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  const register = async () => {
    setLoading(true)
    try {
      const beginRes = await fetch('/api/auth/passkey/register-begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      })
      if (!beginRes.ok) throw new Error('Failed to start')
      const options = await beginRes.json()
      const attestation = await startRegistration({ optionsJSON: options })
      const finishRes = await fetch('/api/auth/passkey/register-finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: attestation, name: name || 'Passkey', origin: window.location.origin }),
      })
      const data = await finishRes.json()
      if (!finishRes.ok) throw new Error(data.error || 'Failed')
      toast.success('Passkey added')
      onOpenChange(false)
      setName('')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancelled')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('security.addPasskey')}</DialogTitle>
          <DialogDescription>Register a passkey with Face ID, Touch ID, or a security key.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="pk-name">Passkey name</Label>
          <Input id="pk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="MacBook Pro" />
        </div>
        <DialogFooter>
          <Button onClick={register} disabled={loading}>
            <Fingerprint className="mr-2 size-4" /> {loading ? t('common.loading') : t('security.addPasskey')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
