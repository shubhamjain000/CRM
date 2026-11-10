'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { ShieldCheck, Plus, GitBranch } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface Role {
  id: string
  name: string
  description: string | null
  permissions: string[]
  parentId: string | null
  parentName: string | null
  isSystem: boolean
  members: number
}

export function RolesView() {
  const t = useTranslations()
  const [roles, setRoles] = React.useState<Role[] | null>(null)

  React.useEffect(() => {
    fetch('/api/roles', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setRoles(d.roles ?? []))
      .catch(() => setRoles([]))
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('roles.title')}</h1>
          <p className="text-muted-foreground">Role hierarchy with inheritance</p>
        </div>
        <Button onClick={() => alert('Role creation form — wired in next phase')}>
          <Plus className="mr-2 size-4" /> {t('roles.addRole')}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {!roles ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
        ) : roles.length === 0 ? (
          <Card className="sm:col-span-2">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              {t('roles.empty')}
            </CardContent>
          </Card>
        ) : (
          roles.map((r) => (
            <Card key={r.id} className="py-5">
              <CardHeader className="gap-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="size-4 text-muted-foreground" />
                    {r.name}
                  </CardTitle>
                  {r.isSystem && <Badge variant="secondary">system</Badge>}
                </div>
                {r.description && <p className="text-sm text-muted-foreground">{r.description}</p>}
              </CardHeader>
              <CardContent className="space-y-3">
                {r.parentName && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <GitBranch className="size-3.5" /> {t('roles.inheritsFrom')}: <span className="font-medium text-foreground">{r.parentName}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {r.permissions.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No direct permissions</span>
                  ) : (
                    r.permissions.map((p) => (
                      <Badge key={p} variant="outline" className="font-mono text-[10px]">{p}</Badge>
                    ))
                  )}
                </div>
                <div className="flex items-center justify-between border-t pt-3 text-sm">
                  <span className="text-muted-foreground">{r.members} {t('roles.members')}</span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
