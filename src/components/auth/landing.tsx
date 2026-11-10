'use client'

import {
  Fingerprint,
  KeyRound,
  Building2,
  ShieldCheck,
  FileText,
  Users,
  ArrowRight,
  Lock,
  Globe,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useTranslations } from 'next-intl'

interface Props {
  onGetStarted: () => void
  onSignIn: () => void
}

export function LandingPage({ onGetStarted, onSignIn }: Props) {
  const t = useTranslations()

  const features = [
    { icon: Fingerprint, title: t('landing.featurePasskeys'), desc: t('landing.featurePasskeysDesc') },
    { icon: KeyRound, title: t('landing.featureSSO'), desc: t('landing.featureSSODesc') },
    { icon: Building2, title: t('landing.featureMultiTenant'), desc: t('landing.featureMultiTenantDesc') },
    { icon: ShieldCheck, title: t('landing.feature2FA'), desc: t('landing.feature2FADesc') },
    { icon: FileText, title: t('landing.featureAudit'), desc: t('landing.featureAuditDesc') },
    { icon: Users, title: t('landing.featureSCIM'), desc: t('landing.featureSCIMDesc') },
  ]

  return (
    <div className="glass-scene flex min-h-screen flex-col bg-background">
      {/* Glass morphism aurora mesh — glows through every translucent surface. */}
      <div aria-hidden="true" className="glass-aurora" />
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Lock className="size-4" />
            </div>
            <span className="font-semibold">{t('app.name')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onSignIn}>
              {t('landing.ctaLogin')}
            </Button>
            <Button size="sm" onClick={onGetStarted}>
              {t('landing.ctaStart')}
              <ArrowRight className="ml-1.5 size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex flex-1 flex-col">
        <section className="relative overflow-hidden border-b">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <Badge variant="outline" className="mb-4">
              <ShieldCheck className="mr-1.5 size-3.5 text-emerald-500" />
              {t('landing.badge')}
            </Badge>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
              {t('landing.heroTitle')}
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
              {t('landing.heroSubtitle')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" onClick={onGetStarted}>
                {t('landing.ctaStart')}
                <ArrowRight className="ml-2 size-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={onSignIn}>
                {t('landing.ctaLogin')}
              </Button>
            </div>

            {/* trust badges */}
            <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-500" /> SOC 2 Type II</span>
              <span className="inline-flex items-center gap-1.5"><Globe className="size-3.5" /> SAML 2.0 / SCIM 2.0</span>
              <span className="inline-flex items-center gap-1.5"><Fingerprint className="size-3.5" /> WebAuthn / Passkeys</span>
              <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" /> Row-Level Security</span>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Card key={f.title} className="gap-3 py-5">
                <CardContent className="space-y-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <f.icon className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 mt-auto border-t bg-background/60 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p>{t('app.name')} · {t('app.tagline')}</p>
          <p>Phase 2 · Enterprise Auth</p>
        </div>
      </footer>
    </div>
  )
}
