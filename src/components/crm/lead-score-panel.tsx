'use client'

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface LeadScoreFactor { key: string; label: string; points: number; note: string }

interface LeadScoreData {
  score: number
  factors: LeadScoreFactor[]
  tier: string
  recommendation: string
}

const TIER_BADGE: Record<string, string> = {
  hot: 'border-red-500/40 text-red-600 dark:text-red-400',
  warm: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  cold: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
}

/**
 * Compact lead-score card for the lead detail view.
 * Props: { leadId: string } — the lead record to score (scores on mount + refresh).
 */
export function LeadScorePanel({ leadId }: { leadId: string }) {
  const [data, setData] = React.useState<LeadScoreData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')

  const load = React.useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/ai/lead-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(typeof d?.error === 'string' && d.error ? d.error : `Request failed (${res.status})`)
      setData({
        score: typeof d?.score === 'number' ? d.score : 0,
        factors: Array.isArray(d?.factors) ? d.factors : [],
        tier: typeof d?.tier === 'string' ? d.tier : 'cold',
        recommendation: typeof d?.recommendation === 'string' ? d.recommendation : '',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the lead score.')
    } finally {
      setLoading(false)
    }
  }, [leadId])

  React.useEffect(() => { load() }, [load])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm">Lead Score</CardTitle>
          <CardDescription>Heuristic score + recommended play</CardDescription>
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={load} disabled={loading} aria-label="Refresh lead score">
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && !data ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-36" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            {error}
          </div>
        ) : data ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{data.score}</span>
              <span className="text-xs text-muted-foreground">/ 100</span>
              <Badge variant="outline" className={`ml-1 capitalize ${TIER_BADGE[data.tier] ?? ''}`}>{data.tier}</Badge>
            </div>
            {data.factors.length > 0 ? (
              <ul className="space-y-1.5">
                {data.factors.map((f) => (
                  <li key={f.key} className="flex items-start gap-2 text-xs">
                    <Badge variant="secondary" className="mt-px shrink-0 tabular-nums">+{f.points}</Badge>
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">{f.label}</span>
                      {' — '}
                      {f.note}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No scoring signals yet — add an email, phone or company to raise the score.</p>
            )}
            {data.recommendation && (
              <p className="rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">{data.recommendation}</p>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
