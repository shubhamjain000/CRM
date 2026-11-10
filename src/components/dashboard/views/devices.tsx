'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { MonitorSmartphone } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

interface DeviceRow {
  id: string
  name: string
  ip: string | null
  userAgent: string | null
  createdAt: string
  lastSeenAt: string
  isCurrent: boolean
}

export function DevicesView() {
  const t = useTranslations()
  const [devices, setDevices] = React.useState<DeviceRow[] | null>(null)

  const load = React.useCallback(() => {
    fetch('/api/devices', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setDevices(d.devices ?? []))
      .catch(() => setDevices([]))
  }, [])
  React.useEffect(load, [load])

  const revoke = async (id: string) => {
    const res = await fetch(`/api/devices?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Session revoked')
      load()
    } else {
      toast.error('Failed to revoke')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('devices.title')}</h1>
        <p className="text-muted-foreground">Active sessions across your devices</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MonitorSmartphone className="size-4" /> {t('devices.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!devices ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : devices.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">{t('devices.empty')}</div>
          ) : (
            <ul className="divide-y">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-4 p-4">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                    <MonitorSmartphone className="size-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{d.name}</p>
                      {d.isCurrent && <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">{t('devices.current')}</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {d.ip ?? 'unknown'} · {d.userAgent?.slice(0, 60) ?? 'unknown'}
                    </p>
                    <p className="text-xs text-muted-foreground">Last seen {new Date(d.lastSeenAt).toLocaleString()}</p>
                  </div>
                  {!d.isCurrent && (
                    <Button variant="outline" size="sm" onClick={() => revoke(d.id)}>
                      {t('devices.revoke')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
