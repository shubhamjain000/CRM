'use client'

import * as React from 'react'
import {
  Apple, BatteryFull, BadgeCheck, Bot, Download, Fingerprint, Globe, RefreshCw,
  Share, Smartphone, Signal, TabletSmartphone, Wifi, MoonStar, ShieldCheck, IndianRupee,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

/**
 * Mobile App showcase — displays the platform as an iOS + Android app:
 *  1. Live device frames (real app running inside iPhone/Android chrome)
 *  2. PWA install steps + QR for the current deployment URL
 *  3. Native shells (Expo) with bundle IDs and build commands
 */

const NAVY = '#223558'

function StatusIcons() {
  return (
    <span className="flex items-center gap-1">
      <Signal className="size-3" />
      <Wifi className="size-3" />
      <BatteryFull className="size-3.5" />
    </span>
  )
}

function DeviceFrame({
  platform,
  reloadKey,
  onReload,
}: {
  platform: 'ios' | 'android'
  reloadKey: number
  onReload: () => void
}) {
  const isIOS = platform === 'ios'
  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`relative bg-zinc-900 shadow-2xl ${isIOS ? 'rounded-[3rem] p-[10px]' : 'rounded-[2.4rem] p-[8px]'}`}>
        <div
          className={`relative flex h-[600px] w-[292px] flex-col overflow-hidden bg-background ${isIOS ? 'rounded-[2.4rem]' : 'rounded-[1.9rem]'}`}
        >
          {/* Status bar */}
          <div
            className="relative z-10 flex h-7 shrink-0 items-center justify-between px-4 text-[10px] font-semibold text-white"
            style={{ backgroundColor: NAVY }}
          >
            <span>9:41</span>
            {isIOS ? (
              <div className="absolute left-1/2 top-1 h-4 w-16 -translate-x-1/2 rounded-full bg-zinc-900" />
            ) : (
              <div className="absolute left-1/2 top-1.5 size-2.5 -translate-x-1/2 rounded-full bg-zinc-900 ring-1 ring-zinc-700" />
            )}
            <StatusIcons />
          </div>
          {/* Live app */}
          <iframe
            key={reloadKey}
            src="/"
            title={isIOS ? 'Unstop CRM live preview on iPhone' : 'Unstop CRM live preview on Android'}
            className="min-h-0 w-full flex-1 border-0 bg-background"
          />
          {isIOS && (
            <div className="pointer-events-none absolute bottom-1 left-1/2 z-10 h-1 w-24 -translate-x-1/2 rounded-full bg-foreground/40" />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1.5">
          {isIOS ? <Apple className="size-3.5" /> : <Smartphone className="size-3.5" />}
          {isIOS ? 'iOS · iPhone 15 Pro' : 'Android · Pixel 8'}
        </Badge>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onReload}>
          <RefreshCw className="mr-1 size-3" /> Reload
        </Button>
      </div>
    </div>
  )
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {i + 1}
          </span>
          <span className="text-foreground/90">{s}</span>
        </li>
      ))}
    </ol>
  )
}

export function MobileAppView() {
  const [origin, setOrigin] = React.useState('')
  const [keys, setKeys] = React.useState({ ios: 0, android: 0 })

  React.useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mobile App</h1>
          <p className="text-muted-foreground">
            Unstop CRM on iOS &amp; Android — installable PWA plus native Expo shells
          </p>
        </div>
        <Badge className="gap-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-400">
          <BadgeCheck className="size-3.5" /> Install-ready
        </Badge>
      </div>

      {/* Live device frames */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TabletSmartphone className="size-4 text-primary" /> Live preview — the actual app
          </CardTitle>
          <CardDescription>
            Real sessions running inside iPhone and Android frames. Resize-friendly, touch-ready,
            safe-area aware — exactly what the installed app renders.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-start justify-center gap-8 lg:justify-between">
            <DeviceFrame
              platform="ios"
              reloadKey={keys.ios}
              onReload={() => setKeys((k) => ({ ...k, ios: k.ios + 1 }))}
            />
            <DeviceFrame
              platform="android"
              reloadKey={keys.android}
              onReload={() => setKeys((k) => ({ ...k, android: k.android + 1 }))}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* Install now */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="size-4 text-primary" /> Install on this phone
            </CardTitle>
            <CardDescription>Scan the QR with your phone camera, then follow the steps.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center">
              {origin ? (
                <div className="rounded-xl border bg-white p-3">
                  <QRCodeSVG value={origin} size={148} fgColor={NAVY} level="M" />
                  <p className="mt-2 max-w-[148px] truncate text-center text-[10px] text-muted-foreground">{origin}</p>
                </div>
              ) : (
                <div className="flex h-[178px] w-[178px] items-center justify-center rounded-xl border bg-muted text-xs text-muted-foreground">
                  Generating…
                </div>
              )}
            </div>
            <Separator />
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Apple className="size-4" /> iPhone / iPad
              </p>
              <StepList
                steps={[
                  'Open this URL in Safari',
                  'Tap the Share button in the toolbar',
                  'Choose "Add to Home Screen"',
                  'Tap Add — Unstop CRM launches full-screen',
                ]}
              />
            </div>
            <Separator />
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Smartphone className="size-4" /> Android
              </p>
              <StepList
                steps={[
                  'Open this URL in Chrome',
                  'Tap the ⋮ menu in the toolbar',
                  'Choose "Install app" / "Add to Home screen"',
                  'Confirm — Unstop CRM appears in your launcher',
                ]}
              />
            </div>
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-4">
          {/* Native shells */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Fingerprint className="size-4 text-primary" /> Native shells (Expo / React Native)
              </CardTitle>
              <CardDescription>
                The <code className="rounded bg-muted px-1 py-0.5 text-xs">mobile/</code> workspace ships a
                native Unstop CRM app for both stores — same API, same session, real native navigation.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Apple className="size-4" /> iOS
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Bundle ID</p>
                <code className="text-xs font-medium">com.unstop.crm</code>
                <div className="mt-2 rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">
                  cd mobile
                  <br />
                  pnpm install
                  <br />
                  eas build --platform ios
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Smartphone className="size-4" /> Android
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Package</p>
                <code className="text-xs font-medium">com.unstop.crm</code>
                <div className="mt-2 rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">
                  cd mobile
                  <br />
                  pnpm install
                  <br />
                  eas build --platform android
                </div>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Try it instantly with Expo Go: run <code className="rounded bg-muted px-1 py-0.5">pnpm start</code> inside{" "}
                <code className="rounded bg-muted px-1 py-0.5">mobile/</code> and scan the terminal QR — the native
                app talks to this same server via <code className="rounded bg-muted px-1 py-0.5">EXPO_PUBLIC_API_URL</code>.
              </p>
            </CardContent>
          </Card>

          {/* What you get */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="size-4 text-primary" /> What the app includes
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2.5 sm:grid-cols-2">
              {[
                { icon: Download, title: 'Installable', desc: 'Home-screen app on iOS & Android — standalone, no browser chrome' },
                { icon: ShieldCheck, title: 'Secure sessions', desc: 'HTTP-only session cookies, tenant-scoped API on every call' },
                { icon: RefreshCw, title: 'Offline-ready shell', desc: 'Service worker caches the shell; network-first for fresh data' },
                { icon: IndianRupee, title: 'India-first', desc: '₹ en-IN formatting, GST totals, +91 defaults across screens' },
                { icon: MoonStar, title: 'Dark mode', desc: 'Follows the device theme just like the desktop app' },
                { icon: Bot, title: 'Zia assistant', desc: 'AI chatbot and notifications travel with you on mobile' },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-3 rounded-lg border p-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
