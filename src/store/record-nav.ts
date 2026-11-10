'use client'

import { create } from 'zustand'

/**
 * Cross-view record navigation.
 *
 * - `lists` caches the ordered record ids per module so the detail view can
 *   offer Previous / Next arrows and ArrowLeft / ArrowRight keyboard movement
 *   through the records the user was just browsing.
 * - `pending` carries a "open this record" request from the global search
 *   palette to the target module view (deep-link into a record).
 */
interface RecordNavState {
  lists: Record<string, string[]>
  setList: (module: string, ids: string[]) => void
  pending: { module: string; id: string } | null
  openRecord: (module: string, id: string) => void
  /** Returns and clears a pending open-request for the given module. */
  consumeRecord: (module: string) => { id: string } | null
  clearPending: () => void
}

export const useRecordNav = create<RecordNavState>((set, get) => ({
  lists: {},
  setList: (module, ids) =>
    set((s) => ({ lists: { ...s.lists, [module]: ids } })),
  pending: null,
  openRecord: (module, id) => set({ pending: { module, id } }),
  consumeRecord: (module) => {
    const p = get().pending
    if (p && p.module === module) {
      set({ pending: null })
      return { id: p.id }
    }
    return null
  },
  clearPending: () => set({ pending: null }),
}))
