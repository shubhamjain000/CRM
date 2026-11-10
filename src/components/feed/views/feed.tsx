'use client'

import * as React from 'react'
import { ActivityFeed } from '../activity-feed'

export function FeedView() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity Feed</h1>
        <p className="text-muted-foreground">Global feed across your organization</p>
      </div>
      <div className="mx-auto max-w-2xl">
        <ActivityFeed />
      </div>
    </div>
  )
}
