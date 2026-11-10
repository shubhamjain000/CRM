'use client'

import * as React from 'react'
import { toast } from 'sonner'

interface ApiListResponse<T> { items: T[]; nextCursor: string | null; total: number }

export function useCrmList<T extends { id: string }>(
  endpoint: string,
  opts: { search?: string; filters?: Record<string, string>; sort?: string; limit?: number } = {},
) {
  const [data, setData] = React.useState<ApiListResponse<T> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const filtersKey = JSON.stringify(opts.filters ?? {})

  const buildParams = React.useCallback((cursor?: string) => {
    const params = new URLSearchParams()
    if (opts.search) params.set('search', opts.search)
    if (opts.sort) params.set('sort', opts.sort)
    if (filtersKey !== '{}') {
      const filters = JSON.parse(filtersKey) as Record<string, string>
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
    }
    params.set('limit', String(opts.limit ?? 100))
    if (cursor) params.set('cursor', cursor)
    return params
  }, [opts.search, opts.sort, filtersKey, opts.limit])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${endpoint}?${buildParams()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load')
      const json: ApiListResponse<T> = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [endpoint, buildParams])

  const loadMore = React.useCallback(async () => {
    if (!data?.nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`${endpoint}?${buildParams(data.nextCursor)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load more')
      const json: ApiListResponse<T> = await res.json()
      setData((prev) => prev
        ? { items: [...prev.items, ...json.items], nextCursor: json.nextCursor, total: json.total }
        : json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }, [endpoint, buildParams, data?.nextCursor, loadingMore])

  React.useEffect(() => { load() }, [load])

  return { data, loading, error, reload: load, loadMore, loadingMore }
}

export async function createRecord(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed')
  return json
}

export async function updateRecord(endpoint: string, id: string, body: Record<string, unknown>) {
  const res = await fetch(`${endpoint}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed')
  return json
}

export async function deleteRecord(endpoint: string, id: string) {
  const res = await fetch(`${endpoint}/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed')
  return res.json()
}

export async function bulkDelete(endpoint: string, ids: string[]) {
  const res = await fetch(`${endpoint}/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed')
  return json
}

export function notify<T>(promise: Promise<T>, msgs: { success: string; error?: string }) {
  return promise
    .then(() => toast.success(msgs.success))
    .catch((e) => toast.error(e instanceof Error ? e.message : (msgs.error ?? 'Failed')))
}
