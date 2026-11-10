'use client'

import * as React from 'react'

export interface ShortcutDef {
  key: string
  description: string
  handler: () => void
  mod?: boolean // requires Cmd/Ctrl
  shift?: boolean
  global?: boolean // works even in inputs
}

export function useKeyboardShortcuts(shortcuts: ShortcutDef[]) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable

      for (const s of shortcuts) {
        if (isInput && !s.global && !(s.mod || s.shift)) continue
        if (s.mod && !(e.metaKey || e.ctrlKey)) continue
        if (s.shift && !e.shiftKey) continue
        if (s.mod || s.shift) {
          if (e.key.toLowerCase() === s.key.toLowerCase()) {
            e.preventDefault()
            s.handler()
            return
          }
        } else {
          if (e.key === s.key) {
            e.preventDefault()
            s.handler()
            return
          }
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shortcuts])
}

export const SHORTCUTS_HELP = [
  { keys: '⌘K', desc: 'Open command palette' },
  { keys: '/', desc: 'Focus search' },
  { keys: 'c', desc: 'Quick create' },
  { keys: 'e', desc: 'Edit selected record' },
  { keys: 'j / k', desc: 'Move down / up in list' },
  { keys: '?', desc: 'Show this help' },
  { keys: 'Esc', desc: 'Close dialogs' },
] as const
