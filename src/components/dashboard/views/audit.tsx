'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { FileText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

interface AuditEvent {
  id: string
  action: string
  actorEmail: string | null
  actorName: string | null
  targetType: string | null
  targetId: string | null
  ip: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export function AuditView() {
  const t = useTranslations()
  const [events, setEvents] = React.useState<AuditEvent[] | null>(null)
  const [filter, setFilter] = React.useState('')

  React.useEffect(() => {
    fetch('/api/audit?limit=200', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .catch(() => setEvents([]))
  }, [])

  const filtered = events?.filter(
    (e) => !filter || e.action.includes(filter) || (e.actorEmail ?? '').includes(filter),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('audit.title')}</h1>
        <p className="text-muted-foreground">Every authentication & authorization event, logged.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" /> {t('audit.title')}
          </CardTitle>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('audit.filterAction')}
            className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </CardHeader>
        <CardContent className="p-0">
          {!filtered ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">{t('audit.empty')}</div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b bg-muted/60 backdrop-blur text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">{t('audit.time')}</th>
                    <th className="px-4 py-2 font-medium">{t('audit.action')}</th>
                    <th className="px-4 py-2 font-medium">{t('audit.user')}</th>
                    <th className="px-4 py-2 font-medium">{t('audit.ip')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="font-mono text-[10px]">{e.action}</Badge>
                      </td>
                      <td className="px-4 py-2.5">{e.actorEmail ?? 'system'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{e.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
