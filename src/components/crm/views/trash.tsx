'use client'

import * as React from 'react'
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

interface TrashItem {
  id: string; module: string; name: string; deletedAt: string
}

export function TrashView() {
  const [items, setItems] = React.useState<TrashItem[] | null>(null)
  const [filter, setFilter] = React.useState<string>('all')

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/trash${filter !== 'all' ? `?module=${filter}` : ''}`, { cache: 'no-store' })
      const data = await res.json()
      setItems(data.items ?? [])
    } catch {
      setItems([])
    }
  }, [filter])

  React.useEffect(() => { load() }, [load])

  const restore = async (item: TrashItem) => {
    const res = await fetch(`/api/crm/trash/${item.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: item.module, action: 'restore' }),
    })
    if (res.ok) {
      toast.success(`Restored ${item.name}`)
      load()
    } else {
      toast.error('Restore failed')
    }
  }

  const purge = async (item: TrashItem) => {
    const res = await fetch(`/api/crm/trash/${item.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: item.module, action: 'purge' }),
    })
    if (res.ok) {
      toast.success(`Permanently deleted ${item.name}`)
      load()
    } else {
      toast.error('Purge failed')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Trash</h1>
        <p className="text-muted-foreground">Recover deleted records (auto-purged after 30 days)</p>
      </div>

      <div className="flex gap-2">
        {['all', 'lead', 'contact', 'account', 'deal'].map((m) => (
          <Button key={m} variant={filter === m ? 'default' : 'outline'} size="sm" onClick={() => setFilter(m)}>
            {m === 'all' ? 'All' : m.charAt(0).toUpperCase() + m.slice(1) + 's'}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trash2 className="size-4" /> Deleted records
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!items ? (
            <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Trash is empty</div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const age = Math.floor((Date.now() - new Date(item.deletedAt).getTime()) / 86400000)
                const daysLeft = 30 - age
                return (
                  <li key={`${item.module}-${item.id}`} className="flex items-center gap-4 p-4">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                      <Trash2 className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <Badge variant="outline" className="mr-1.5 text-[10px] capitalize">{item.module}</Badge>
                        deleted {age}d ago
                        {daysLeft <= 7 && <span className="ml-1.5 text-amber-600">· {daysLeft}d until purge</span>}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => restore(item)}>
                      <RotateCcw className="mr-1.5 size-3.5" /> Restore
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => purge(item)}>
                      <AlertTriangle className="mr-1.5 size-3.5" /> Purge
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
