'use client'

import * as React from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { safeJsonParse } from '@/components/safe-json'

/**
 * Shared owner (record assignment) building blocks:
 * - useOrgMembers(): org members with a module-level cache + id→name map
 * - OwnerCell: avatar + owner name for list columns
 * - buildWhatsappUrl(): phone normalization for wa.me deep links
 * - logOutreach(): record WhatsApp/email touchpoints on the record timeline
 */

export interface OrgMember {
  id: string
  name: string
  email: string
}

interface MembersCache {
  members: OrgMember[] | null
  byId: Map<string, OrgMember>
  promise: Promise<void> | null
}

const cache: MembersCache = { members: null, byId: new Map(), promise: null }

function ingest(members: OrgMember[]) {
  cache.members = members
  cache.byId = new Map(members.map((m) => [m.id, m]))
}

/** Fetch (once, cached) the active members of the current organization. */
export function useOrgMembers(): { members: OrgMember[]; nameById: Map<string, string> } {
  const [members, setMembers] = React.useState<OrgMember[] | null>(cache.members)

  React.useEffect(() => {
    if (cache.members) {
      setMembers(cache.members)
      return
    }
    if (!cache.promise) {
      cache.promise = fetch('/api/crm/members', { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error('members unavailable')
          return r.json()
        })
        .then((d) => { ingest(d.members ?? []) })
        .catch(() => {
          // Keep any previously loaded members; allow a retry on the next mount
          // instead of caching an empty result forever.
          cache.promise = null
        })
    }
    let cancelled = false
    cache.promise.then(() => { if (!cancelled) setMembers(cache.members) })
    return () => { cancelled = true }
  }, [])

  const nameById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const m of members ?? []) map.set(m.id, m.name)
    return map
  }, [members])

  return { members: members ?? [], nameById }
}

const AVATAR_TONES = [
  'bg-primary/12 text-primary dark:bg-primary/20 dark:text-primary',
  'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/14 text-amber-700 dark:text-amber-300',
  'bg-rose-500/12 text-rose-700 dark:text-rose-300',
  'bg-teal-500/12 text-teal-700 dark:text-teal-300',
  'bg-violet-500/12 text-violet-700 dark:text-violet-300',
]

function toneFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

/** Avatar + owner name for list cells; renders '—' when unresolvable. */
export function OwnerCell({ ownerId, nameById }: { ownerId?: string | null; nameById: Map<string, string> }) {
  if (!ownerId) return <span className="text-muted-foreground">—</span>
  const name = nameById.get(ownerId)
  if (!name) return <span className="font-mono text-xs text-muted-foreground">{ownerId.slice(-8)}</span>
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar className="size-6 shrink-0">
        <AvatarFallback className={`text-[10px] font-semibold ${toneFor(ownerId)}`}>{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <span className="truncate text-sm">{name}</span>
    </span>
  )
}

/** First phone number from a record's phones JSON column. */
export function firstPhone(phonesJson: string | undefined | null): string {
  const phones = safeJsonParse<string[]>(phonesJson ?? '[]', [])
  return phones.find((p) => typeof p === 'string' && p.trim()) ?? ''
}

/**
 * wa.me deep link for a phone number. Indian-market aware: a bare 10-digit
 * mobile becomes 91XXXXXXXXXX; a leading 0 is treated as an STD prefix.
 */
export function buildWhatsappUrl(phone: string, text?: string): string | null {
  let digits = phone.replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 11 && digits.startsWith('0')) digits = `91${digits.slice(1)}`
  if (digits.length === 10) digits = `91${digits}`
  if (digits.length < 11 || digits.length > 15) return null
  const url = new URL(`https://wa.me/${digits}`)
  if (text) url.searchParams.set('text', text)
  return url.toString()
}

/** Record an out-of-app outreach touchpoint (WhatsApp, mail client, …). */
export async function logOutreach(input: {
  module: string
  recordId: string
  channel: 'whatsapp' | 'email' | 'call' | 'sms'
  description?: string
}): Promise<void> {
  try {
    await fetch('/api/crm/outreach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    // Outreach logging is best-effort — never block the user action.
  }
}
