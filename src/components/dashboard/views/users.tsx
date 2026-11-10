'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  UserPlus, Trash2, Eye, EyeOff, Copy, RefreshCw, Check, X, KeyRound, Info,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { USER_TYPE_HELP, type UserTypeName } from '@/lib/auth/client-permissions'

interface UserRow {
  id: string
  name: string
  email: string
  isSuperuser?: boolean
  role: string
  roleId: string
  status: string
  lastActive: string
}

const ALL_USER_TYPES: UserTypeName[] = ['Admin', 'Manager', 'Agent', 'Viewer']

/** Feature → user types allowed. Denied = every other type. */
const PERMISSION_MATRIX: { feature: string; allowed: UserTypeName[] }[] = [
  { feature: 'Import / Export', allowed: ['Admin'] },
  { feature: 'AI Template Feature', allowed: ['Admin', 'Manager'] },
  { feature: 'Connector Management (WhatsApp/Gmail)', allowed: ['Admin'] },
  { feature: 'Manage Users', allowed: ['Admin'] },
  { feature: 'Delete Records', allowed: ['Admin', 'Manager'] },
]

const PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** CSPRNG password (12 chars, A-Za-z0-9) via window.crypto with rejection sampling. */
function generatePassword(length = 12): string {
  if (typeof window === 'undefined' || !window.crypto?.getRandomValues) {
    return Array.from(
      { length },
      () => PASSWORD_ALPHABET[Math.floor(Math.random() * PASSWORD_ALPHABET.length)],
    ).join('')
  }
  const buf = new Uint8Array(1)
  const limit = Math.floor(256 / PASSWORD_ALPHABET.length) * PASSWORD_ALPHABET.length
  const out: string[] = []
  while (out.length < length) {
    window.crypto.getRandomValues(buf)
    if (buf[0] >= limit) continue // reject to avoid modulo bias
    out.push(PASSWORD_ALPHABET[buf[0] % PASSWORD_ALPHABET.length])
  }
  return out.join('')
}

export function UsersView() {
  const t = useTranslations()
  const [users, setUsers] = React.useState<UserRow[] | null>(null)
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)

  // Invite form state
  const [inviteName, setInviteName] = React.useState('')
  const [inviteEmail, setInviteEmail] = React.useState('')
  const [autoPassword, setAutoPassword] = React.useState(true)
  const [generatedPassword, setGeneratedPassword] = React.useState('')
  const [manualPassword, setManualPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [userType, setUserType] = React.useState<UserTypeName>('Agent')
  const [submitting, setSubmitting] = React.useState(false)

  // Post-create credentials panel (shown when the invite email could not be sent)
  const [created, setCreated] = React.useState<{ email: string; password: string | null } | null>(null)

  // Delete flow
  const [deleteTarget, setDeleteTarget] = React.useState<UserRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const load = React.useCallback(async () => {
    const [u, me] = await Promise.all([
      fetch('/api/users', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    ])
    setUsers(u.users ?? [])
    setCurrentUserId(me.user?.id ?? null)
  }, [])

  React.useEffect(() => { load() }, [load])

  const openInvite = () => {
    setInviteName('')
    setInviteEmail('')
    setAutoPassword(true)
    setManualPassword('')
    setGeneratedPassword(generatePassword())
    setShowPassword(false)
    setUserType('Agent')
    setCreated(null)
    setOpen(true)
  }

  const copyValue = async (value: string | null | undefined) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Copy failed — select the text manually')
    }
  }

  const emailValid = EMAIL_RE.test(inviteEmail.trim())
  const manualPasswordValid = manualPassword.length >= 8
  const canSubmit = inviteName.trim().length > 0 && emailValid && (autoPassword || manualPasswordValid)

  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteName.trim() || !emailValid) {
      toast.error('Please fill in a name and a valid email address')
      return
    }
    if (!autoPassword && !manualPasswordValid) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          name: inviteName.trim(),
          userType,
          password: autoPassword ? generatedPassword : manualPassword,
          clientUrl: window.location.origin,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      const email = data.credentials?.email ?? inviteEmail.trim()
      const password = data.credentials?.password ?? null
      if (data.emailSent) {
        toast.success(`Invited ${email} — invitation email sent`)
        setOpen(false)
      } else {
        toast.warning('User created — invitation email could not be sent')
        setCreated({ email, password })
      }
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/users/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to delete user')
      toast.success(`Deleted ${deleteTarget.name}`)
      setDeleteTarget(null)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete user')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('users.title')}</h1>
          <p className="text-muted-foreground">Manage members of this organization</p>
        </div>
        <Button onClick={openInvite}>
          <UserPlus className="mr-2 size-4" /> {t('users.addUser')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('users.title')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!users ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : users.length === 0 ? (
            <EmptyState label={t('users.empty')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t('users.name')}</th>
                    <th className="px-4 py-3 font-medium">{t('users.role')}</th>
                    <th className="px-4 py-3 font-medium">{t('users.status')}</th>
                    <th className="px-4 py-3 font-medium">{t('users.lastActive')}</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.id === currentUserId
                    const hideDelete = isSelf || u.isSuperuser
                    return (
                      <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <p className="font-medium">{u.name}{isSelf ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary">{u.role}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                            {t(`common.${u.status === 'active' ? 'active' : 'suspended'}`)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(u.lastActive).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!hideDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-destructive"
                              aria-label={`Delete ${u.name}`}
                              onClick={() => setDeleteTarget(u)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) setCreated(null)
          setOpen(v)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('users.addUser')}</DialogTitle>
            <DialogDescription>Invite a member to this organization.</DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">User created</p>
                <p className="text-xs text-muted-foreground">
                  They can sign in as soon as you share their credentials.
                </p>
              </div>
              <div className="space-y-2 rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <KeyRound className="size-4" /> Share credentials
                </p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={created.email} className="font-mono text-xs" aria-label="User email" />
                  <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Copy email" onClick={() => copyValue(created.email)}>
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={created.password ?? 'Existing account — password unchanged'}
                    className="font-mono text-xs"
                    aria-label="User password"
                  />
                  {created.password && (
                    <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Copy password" onClick={() => copyValue(created.password)}>
                      <Copy className="size-3.5" />
                    </Button>
                  )}
                </div>
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  Invitation email could not be sent (SMTP not configured) — share these credentials manually.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => { setCreated(null); setOpen(false) }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={invite} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="iname">{t('auth.fullName')}</Label>
                <Input id="iname" value={inviteName} onChange={(e) => setInviteName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iemail">{t('auth.email')}</Label>
                <Input
                  id="iemail"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  aria-invalid={inviteEmail.length > 0 && !emailValid}
                  required
                />
                {inviteEmail.length > 0 && !emailValid && (
                  <p className="text-xs text-destructive">Enter a valid email address</p>
                )}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ipassword">Password</Label>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="auto-password" className="text-xs text-muted-foreground">Auto-generate</Label>
                    <Switch
                      id="auto-password"
                      checked={autoPassword}
                      onCheckedChange={(v) => {
                        setAutoPassword(v)
                        if (v) {
                          setGeneratedPassword(generatePassword())
                          setShowPassword(false)
                        }
                      }}
                    />
                  </div>
                </div>
                {autoPassword ? (
                  <div className="flex items-center gap-2">
                    <Input
                      id="ipassword"
                      readOnly
                      type={showPassword ? 'text' : 'password'}
                      value={generatedPassword}
                      className="font-mono text-xs"
                      aria-label="Generated password"
                    />
                    <Button type="button" variant="outline" size="icon" className="size-8" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((s) => !s)}>
                      {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </Button>
                    <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Copy password" onClick={() => copyValue(generatedPassword)}>
                      <Copy className="size-3.5" />
                    </Button>
                    <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Regenerate password" onClick={() => { setGeneratedPassword(generatePassword()); setShowPassword(true) }}>
                      <RefreshCw className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Input
                      id="ipassword"
                      type={showPassword ? 'text' : 'password'}
                      value={manualPassword}
                      onChange={(e) => setManualPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      aria-invalid={manualPassword.length > 0 && !manualPasswordValid}
                    />
                    <div className="flex items-center justify-between">
                      {manualPassword.length > 0 && !manualPasswordValid ? (
                        <p className="text-xs text-destructive">Password must be at least 8 characters</p>
                      ) : <span />}
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground" onClick={() => setShowPassword((s) => !s)}>
                        {showPassword ? <EyeOff className="mr-1 size-3" /> : <Eye className="mr-1 size-3" />}
                        {showPassword ? 'Hide' : 'Show'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>User type</Label>
                <Select value={userType} onValueChange={(v) => setUserType(v as UserTypeName)}>
                  <SelectTrigger><SelectValue placeholder="User type" /></SelectTrigger>
                  <SelectContent>
                    {ALL_USER_TYPES.map((ut) => (
                      <SelectItem key={ut} value={ut}>{ut}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{USER_TYPE_HELP[userType]}</p>
                <PermissionsMatrix selected={userType} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={submitting || !canSubmit}>
                  {submitting ? t('common.loading') : t('users.invite')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Are you sure you want to delete ${deleteTarget.name}? This action cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); confirmDelete() }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Two-column Allowed / Denied summary for the selected user type. */
function PermissionsMatrix({ selected }: { selected: UserTypeName }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium">Feature</th>
            <th className="px-2 py-1.5 font-medium text-emerald-600 dark:text-emerald-400">Allowed</th>
            <th className="px-2 py-1.5 font-medium">Denied</th>
          </tr>
        </thead>
        <tbody>
          {PERMISSION_MATRIX.map((row) => {
            const denied = ALL_USER_TYPES.filter((ut) => !row.allowed.includes(ut))
            return (
              <tr key={row.feature} className="border-t">
                <td className="px-2 py-1.5">
                  {row.feature}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {row.allowed.map((ut) => (
                      <span
                        key={ut}
                        className={`inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400${ut === selected ? ' font-semibold' : ''}`}
                      >
                        <Check className="size-3" /> {ut}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-1 text-muted-foreground">
                    {denied.map((ut) => (
                      <span key={ut} className={`inline-flex items-center gap-0.5${ut === selected ? ' font-semibold' : ''}`}>
                        <X className="size-3" /> {ut}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <UserPlus className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}
