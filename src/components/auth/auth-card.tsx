'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'
import {
  Fingerprint,
  Mail,
  Lock,
  ArrowLeft,
  ShieldCheck,
  Building2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

type Mode = 'signin' | 'signup'
type Method = 'password' | 'magic-link' | 'sso'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(res: Response): Promise<any> {
  // Never throw on empty/HTML bodies — e.g. a 500 dev-overlay page when the
  // server can't reach the database. Returning {} lets call sites surface the
  // HTTP status as a normal error message instead of crashing with
  // "Failed to execute 'json' on 'Response': Unexpected end of JSON input".
  try {
    return await res.json()
  } catch {
    return {}
  }
}

interface Props {
  initialMode: Mode
  onBack: () => void
  onAuthed: (token?: string) => void
}

export function AuthCard({ initialMode, onBack, onAuthed }: Props) {
  const t = useTranslations()
  const [mode, setMode] = React.useState<Mode>(initialMode)
  const [method, setMethod] = React.useState<Method>('password')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [name, setName] = React.useState('')
  const [orgName, setOrgName] = React.useState('')
  const [totp, setTotp] = React.useState('')
  const [twoFactorUserId, setTwoFactorUserId] = React.useState<string | null>(null)
  const [ssoDomain, setSsoDomain] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [magicSent, setMagicSent] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [showPassword, setShowPassword] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const confirmMismatch = mode === 'signup' && confirm.length > 0 && password !== confirm

  const toggleButton = (show: boolean, onClick: () => void, which: string) => (
    <button
      type="button"
      tabIndex={-1}
      aria-label={show ? `Hide ${which}` : `Show ${which}`}
      onClick={onClick}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      {show ? 'Hide' : 'Show'}
    </button>
  )

  React.useEffect(() => setMode(initialMode), [initialMode])

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    // Signup: never submit when the confirmation doesn't match — submitting
    // would create the account with the FIRST password while the user believes
    // it is the second one, and the very next sign-in then fails with
    // "Invalid credentials" (the classic "signup worked, login doesn't" trap).
    if (mode === 'signup' && password !== confirm) {
      const msg = "Passwords don't match — retype the same password in both fields."
      setFormError(msg)
      toast.error(msg)
      return
    }
    setLoading(true)
    try {
      if (mode === 'signup') {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name, orgName }),
        })
        const data = await readJson(res)
        if (!res.ok) {
          // Surface the password-policy reasons, not just "Password too weak" —
          // otherwise users can't tell WHY signup failed.
          const reasons: string[] = Array.isArray(data.reasons) ? data.reasons : []
          throw new Error(reasons.length > 0 ? `${data.error || 'Signup failed'}: ${reasons.join(', ')}` : data.error || 'Signup failed')
        }
        toast.success('Account created')
        onAuthed(data.token)
        return
      }
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, totp: twoFactorUserId ? totp : undefined }),
      })
      const data = await readJson(res)
      if (res.status === 202 && data.twoFactorRequired) {
        setTwoFactorUserId(data.userId)
        toast.info('Enter your 2FA code')
        return
      }
      if (!res.ok) throw new Error(data.error || `Login failed (server error ${res.status})`)
      toast.success('Signed in')
      onAuthed(data.token)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setFormError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const submitMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await readJson(res)
      if (!res.ok) throw new Error(data.error || 'Failed')
      setMagicSent(true)
      if (data.devLink) {
        // Sandbox: verify the link directly.
        toast.info('Verifying magic link…')
        const v = await fetch(data.devLink, { method: 'POST' })
        if (v.ok) {
          const vdata = await v.json().catch(() => ({}))
          toast.success('Signed in via magic link')
          onAuthed(vdata.token)
        } else {
          throw new Error('Magic link verification failed')
        }
      } else {
        toast.success(t('auth.magicLinkSent'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const passkeyLogin = async () => {
    if (!email) {
      toast.error('Enter your email first')
      return
    }
    setLoading(true)
    try {
      const beginRes = await fetch('/api/auth/passkey/login-begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, origin: window.location.origin }),
      })
      if (!beginRes.ok) throw new Error((await readJson(beginRes)).error || 'No passkey')
      const options = await readJson(beginRes)
      const assertion = await startAuthentication({ optionsJSON: options })
      const finishRes = await fetch('/api/auth/passkey/login-finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, response: assertion, origin: window.location.origin }),
      })
      const data = await readJson(finishRes)
      if (!finishRes.ok) throw new Error(data.error || 'Passkey failed')
      toast.success('Signed in with passkey')
      onAuthed()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Passkey cancelled')
    } finally {
      setLoading(false)
    }
  }

  const submitSSO = async (e: React.FormEvent) => {
    e.preventDefault()
    toast.info('SSO redirect (simulated in sandbox). Configure Okta/Azure AD in /backend.')
  }

  return (
    <div className="glass-scene flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div aria-hidden="true" className="glass-aurora" />
      <div className="relative z-10 w-full max-w-md">
        <button
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back
        </button>

        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" />
            </div>
            <CardTitle className="text-xl">
              {mode === 'signin' ? t('auth.signInTitle') : t('auth.signUpTitle')}
            </CardTitle>
            <CardDescription>
              {mode === 'signin' ? t('auth.haveAccount') : t('auth.needAccount')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Method tabs */}
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-sm">
              <MethodTab active={method === 'password'} onClick={() => setMethod('password')}>
                <Lock className="size-3.5" /> {t('auth.password')}
              </MethodTab>
              <MethodTab active={method === 'magic-link'} onClick={() => setMethod('magic-link')}>
                <Mail className="size-3.5" /> {t('auth.magicLink')}
              </MethodTab>
              <MethodTab active={method === 'sso'} onClick={() => setMethod('sso')}>
                <Building2 className="size-3.5" /> {t('auth.sso')}
              </MethodTab>
            </div>

            {/* Passkey button always available */}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={passkeyLogin}
              disabled={loading || mode === 'signup'}
            >
              <Fingerprint className="mr-2 size-4" />
              {t('auth.passkey')}
            </Button>

            <div className="relative">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                {t('auth.orContinueWith')}
              </span>
            </div>

            {/* Password form */}
            {method === 'password' && (
              <form onSubmit={submitPassword} className="space-y-3">
                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="name">{t('auth.fullName')}</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t('auth.email')}</Label>
                  <Input id="email" type="email" autoComplete="email" value={email}
                    onChange={(e) => setEmail(e.target.value)} required />
                </div>
                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="org">{t('landing.featureMultiTenant')}</Label>
                    <Input id="org" placeholder="Acme Inc." value={orgName}
                      onChange={(e) => setOrgName(e.target.value)} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="password">{t('auth.password')}</Label>
                  <div className="relative">
                    <Input id="password" type={showPassword ? 'text' : 'password'} value={password}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      onChange={(e) => setPassword(e.target.value)} required className="pr-14" />
                    {toggleButton(showPassword, () => setShowPassword((v) => !v), 'password')}
                  </div>
                  {mode === 'signup' && (
                    <p className="text-xs text-muted-foreground">
                      Min 10 chars with uppercase, lowercase, number & symbol.
                      Known-breached passwords are rejected.
                    </p>
                  )}
                </div>
                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm">{t('auth.confirmPassword')}</Label>
                    <div className="relative">
                      <Input id="confirm" type={showConfirm ? 'text' : 'password'} value={confirm}
                        autoComplete="new-password"
                        onChange={(e) => setConfirm(e.target.value)} required className="pr-14" />
                      {toggleButton(showConfirm, () => setShowConfirm((v) => !v), 'confirmation password')}
                    </div>
                    {confirmMismatch && (
                      <p className="text-xs text-destructive">Passwords don't match</p>
                    )}
                  </div>
                )}
                {twoFactorUserId && (
                  <div className="space-y-1.5">
                    <Label htmlFor="totp">{t('auth.twoFactorPrompt')}</Label>
                    <Input id="totp" inputMode="numeric" maxLength={6} value={totp}
                      onChange={(e) => setTotp(e.target.value)} placeholder="123456" required />
                  </div>
                )}
                {formError && (
                  <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {formError}
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={loading || confirmMismatch}>
                  {loading
                    ? mode === 'signin' ? t('auth.signingIn') : t('auth.signingUp')
                    : mode === 'signin' ? t('auth.signIn') : t('auth.signUp')}
                </Button>
              </form>
            )}

            {/* Magic link */}
            {method === 'magic-link' && (
              <form onSubmit={submitMagicLink} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ml-email">{t('auth.email')}</Label>
                  <Input id="ml-email" type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)} required />
                </div>
                {magicSent && (
                  <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                    {t('auth.magicLinkSent')}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? t('common.loading') : t('auth.sendMagicLink')}
                </Button>
              </form>
            )}

            {/* SSO */}
            {method === 'sso' && (
              <form onSubmit={submitSSO} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sso">{t('auth.sso')}</Label>
                  <Input id="sso" placeholder={t('auth.ssoPlaceholder')} value={ssoDomain}
                    onChange={(e) => setSsoDomain(e.target.value)} />
                </div>
                <Button type="submit" className="w-full">{t('auth.continueWithSSO')}</Button>
                <div className="grid grid-cols-3 gap-2 pt-2">
                  {(['google', 'microsoft', 'github', 'apple', 'linkedin'] as const).map((p) => (
                    <Button key={p} type="button" variant="outline" size="sm"
                      onClick={() => toast.info(`${t(`auth.${p}`)} OAuth (configure in /backend)`)}>
                      {t(`auth.${p}`)}
                    </Button>
                  ))}
                </div>
              </form>
            )}

            {/* Mode switch */}
            <div className="pt-2 text-center text-sm text-muted-foreground">
              {mode === 'signin' ? t('auth.needAccount') : t('auth.haveAccount')}{' '}
              <button
                type="button"
                className="font-medium text-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin')
                  setTwoFactorUserId(null)
                  setTotp('')
                  setFormError(null)
                }}
              >
                {mode === 'signin' ? t('auth.signUp') : t('auth.signIn')}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MethodTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition ${
        active ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
