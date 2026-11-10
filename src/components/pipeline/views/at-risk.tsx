'use client'

import * as React from 'react'
import { AlertTriangle, Clock, IndianRupee } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtCompactBare } from '@/lib/money'

interface AtRiskDeal {
  id: string; name: string; amount: number; reason: string
  daysInStage: number; closeDate: string | null; stageName: string
}

export function AtRiskView() {
  const [deals, setDeals] = React.useState<AtRiskDeal[] | null>(null)

  React.useEffect(() => {
    fetch('/api/pipelines/at-risk', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setDeals(d.deals ?? []))
      .catch(() => setDeals([]))
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">At Risk</h1>
        <p className="text-muted-foreground">Deals stuck in stage too long or with passed close dates</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-amber-500" /> At-risk deals
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!deals ? (
            <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : deals.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
                <AlertTriangle className="size-5 text-emerald-500" />
              </div>
              <p className="text-sm text-muted-foreground">No deals at risk. Everything looks healthy!</p>
            </div>
          ) : (
            <ul className="divide-y">
              {deals.map((d) => (
                <li key={d.id + d.reason} className="flex items-center gap-4 p-4">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10">
                    <AlertTriangle className="size-4 text-amber-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{d.name}</p>
                      <Badge variant="outline" className="text-[10px]">{d.stageName}</Badge>
                    </div>
                    <p className="text-xs text-amber-600 dark:text-amber-400">{d.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className="flex items-center gap-1 text-sm font-semibold">
                      <IndianRupee className="size-3 text-muted-foreground" />
                      {fmtCompactBare(d.amount)}
                    </p>
                    {d.closeDate && <p className="text-xs text-muted-foreground">Close: {new Date(d.closeDate).toLocaleDateString()}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
