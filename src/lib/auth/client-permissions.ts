'use client'

/**
 * Shared client-side permission helper (additive — no existing behavior changed).
 *
 * Maps the current organization role to the Unstop user types and exposes the
 * three capability gates required by the UI:
 *   - canImportExport      → Admin only
 *   - canUseAiTemplates    → Admin + Manager
 *   - canManageConnectors  → Admin only
 *
 * Reads /api/auth/me once per page load (module-level cache) and revalidates on
 * window focus so login/logout/org-switch updates without a reload.
 */

import * as React from 'react'

export type UserTypeName = 'Admin' | 'Manager' | 'Agent' | 'Viewer'

export interface PermissionsState {
  loading: boolean
  role: string
  userType: UserTypeName
  isAdmin: boolean
  isManager: boolean
  permissions: string[]
  can: (perm: string) => boolean
  canImportExport: boolean
  canUseAiTemplates: boolean
  canManageConnectors: boolean
}

export const USER_TYPE_HELP: Record<UserTypeName, string> = {
  Admin: 'Full platform control — users, connectors (WhatsApp/Gmail), import/export, AI templates, rules and settings.',
  Manager: 'Run the CRM — AI templates, rules, workflows and all record operations. No import/export, no connector management.',
  Agent: 'Day-to-day selling — records, notes, tasks and outreach. No import/export, AI templates or connector management.',
  Viewer: 'Read-only visibility into records and dashboards. No import/export, AI templates or connector management.',
}

export function normalizeUserType(role: string | undefined | null, permissions: string[] = []): UserTypeName {
  const r = (role || '').toLowerCase()
  if (r.includes('admin') || r.includes('owner')) return 'Admin'
  if (r.includes('manager')) return 'Manager'
  if (r.includes('agent')) return 'Agent'
  if (r.includes('viewer') || r.includes('read only') || r.includes('read-only')) return 'Viewer'
  if (permissions.includes('*') || permissions.includes('admin.all')) return 'Admin'
  if (permissions.some((p) => p.startsWith('manage') || p.startsWith('admin'))) return 'Manager'
  return 'Agent'
}

let cache: { at: number; role: string; permissions: string[] } | null = null
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null

async function load() {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.user) {
        const current = (data.organizations ?? []).find((o: { isCurrent?: boolean }) => o.isCurrent) ?? (data.organizations ?? [])[0]
        cache = {
          at: Date.now(),
          role: current?.role ?? 'Member',
          permissions: Array.isArray(data.permissions) ? data.permissions : [],
        }
      } else {
        cache = { at: Date.now(), role: '', permissions: [] }
      }
    } catch {
      cache = { at: Date.now(), role: '', permissions: [] }
    } finally {
      inflight = null
      listeners.forEach((l) => l())
    }
  })()
  return inflight
}

/** React hook — use `usePermissions()` wherever a feature must be gated. */
export function usePermissions(): PermissionsState {
  const [, bump] = React.useReducer((n: number) => n + 1, 0)

  React.useEffect(() => {
    const l = () => bump()
    listeners.add(l)
    if (!cache) void load()
    const onFocus = () => {
      if (cache && Date.now() - cache.at > 60_000) void load()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      listeners.delete(l)
      window.removeEventListener('focus', onFocus)
    }
  }, [bump])

  const role = cache?.role ?? ''
  const permissions = cache?.permissions ?? []
  const userType = normalizeUserType(role, permissions)
  const isAdmin = userType === 'Admin'
  const isManager = userType === 'Manager'
  const can = (perm: string) => permissions.includes(perm) || permissions.includes('*')

  return {
    loading: !cache,
    role: role || 'Member',
    userType,
    isAdmin,
    isManager,
    permissions,
    can,
    canImportExport: isAdmin,
    canUseAiTemplates: isAdmin || isManager,
    canManageConnectors: isAdmin,
  }
}

/** Imperative check for non-hook code paths (event handlers before opening a dialog). */
export async function getPermissions(): Promise<PermissionsState> {
  if (!cache) await load()
  const role = cache?.role ?? ''
  const permissions = cache?.permissions ?? []
  const userType = normalizeUserType(role, permissions)
  const isAdmin = userType === 'Admin'
  const isManager = userType === 'Manager'
  return {
    loading: false,
    role: role || 'Member',
    userType,
    isAdmin,
    isManager,
    permissions,
    can: (perm: string) => permissions.includes(perm) || permissions.includes('*'),
    canImportExport: isAdmin,
    canUseAiTemplates: isAdmin || isManager,
    canManageConnectors: isAdmin,
  }
}
