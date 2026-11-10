'use client'

// RecordTags — Zoho-style colored tags on lead/contact/account/deal records.
// Renders linked tag chips; the + popover toggles existing org tags and
// creates new ones (name + preset color). Non-taggable modules render nothing.

import * as React from 'react'
import { Plus, Tag as TagIcon, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'

const TAGGABLE = new Set(['lead', 'contact', 'account', 'deal'])

const COLORS = ['slate', 'red', 'amber', 'emerald', 'teal', 'sky', 'violet', 'pink'] as const
type TagColor = (typeof COLORS)[number]

const CHIP_CLASS: Record<string, string> = {
  slate: 'border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300',
  red: 'border-red-400/40 bg-red-500/10 text-red-600 dark:text-red-300',
  amber: 'border-amber-400/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  emerald: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  teal: 'border-teal-400/40 bg-teal-500/10 text-teal-600 dark:text-teal-300',
  sky: 'border-sky-400/40 bg-sky-500/10 text-sky-600 dark:text-sky-300',
  violet: 'border-violet-400/40 bg-violet-500/10 text-violet-600 dark:text-violet-300',
  pink: 'border-pink-400/40 bg-pink-500/10 text-pink-600 dark:text-pink-300',
}

const DOT_CLASS: Record<string, string> = {
  slate: 'bg-slate-400', red: 'bg-red-400', amber: 'bg-amber-400', emerald: 'bg-emerald-400',
  teal: 'bg-teal-400', sky: 'bg-sky-400', violet: 'bg-violet-400', pink: 'bg-pink-400',
}

interface Tag {
  id: string
  name: string
  color: string
  linked: boolean
}

export function RecordTags({ module, recordId }: { module: string; recordId: string }) {
  const [tags, setTags] = React.useState<Tag[] | null>(null)
  const [open, setOpen] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [newColor, setNewColor] = React.useState<TagColor>('slate')
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!TAGGABLE.has(module) || !recordId) return
    try {
      const res = await fetch(`/api/crm/tags?module=${module}&recordId=${encodeURIComponent(recordId)}`, { cache: 'no-store' })
      const data = await res.json()
      setTags(res.ok ? (data.tags as Tag[]) : [])
    } catch {
      setTags([])
    }
  }, [module, recordId])

  React.useEffect(() => { load() }, [load])

  if (!TAGGABLE.has(module)) return null

  const toggle = async (tag: Tag, on: boolean) => {
    // optimistic flip
    setTags((prev) => (prev ?? []).map((t) => (t.id === tag.id ? { ...t, linked: on } : t)))
    try {
      const res = await fetch('/api/crm/tags/links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module, recordId, tagId: tag.id, on }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setTags((prev) => (prev ?? []).map((t) => (t.id === tag.id ? { ...t, linked: !on } : t)))
      toast.error('Could not update tags')
    }
  }

  const createTag = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await fetch('/api/crm/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: newColor }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Create failed')
      const tag: Tag = { ...data, linked: false }
      setNewName('')
      // auto-link to the current record
      await toggle(tag, true)
      load()
      toast.success(`Tag "${name}" added`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create tag')
    } finally {
      setBusy(false)
    }
  }

  const linked = (tags ?? []).filter((t) => t.linked)

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Record tags">
      {!tags ? (
        <Skeleton className="h-5 w-40" />
      ) : (
        <>
          {linked.map((t) => (
            <span
              key={t.id}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${CHIP_CLASS[t.color] ?? CHIP_CLASS.slate}`}
            >
              <TagIcon className="size-3" aria-hidden />
              {t.name}
              <button
                type="button" onClick={() => toggle(t, false)}
                className="ml-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                aria-label={`Remove tag ${t.name}`}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex size-5 items-center justify-center rounded-full border border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                aria-label="Manage tags"
              >
                <Plus className="size-3" aria-hidden />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3">
              <p className="mb-2 text-xs font-medium">Tags on this record</p>
              {(tags ?? []).length === 0 ? (
                <p className="mb-2 text-xs text-muted-foreground">No tags yet — create the first one below.</p>
              ) : (
                <ul className="mb-2 max-h-40 space-y-1 overflow-y-auto" role="listbox" aria-label="All tags">
                  {(tags ?? []).map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={t.linked}
                        onClick={() => toggle(t, !t.linked)}
                        className={`flex w-full items-center gap-2 rounded-md border p-1.5 text-left text-xs transition-colors ${
                          t.linked ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                        }`}
                      >
                        <span className={`size-2 shrink-0 rounded-full ${DOT_CLASS[t.color] ?? DOT_CLASS.slate}`} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        {t.linked && <span className="text-[10px] text-emerald-600">on record</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t pt-2">
                <div className="flex gap-1.5">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createTag() } }}
                    placeholder="New tag name…"
                    className="h-8 text-xs"
                    aria-label="New tag name"
                  />
                  <Button size="sm" className="h-8 shrink-0" onClick={createTag} disabled={busy || !newName.trim()}>
                    Add
                  </Button>
                </div>
                <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Tag color">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={newColor === c}
                      aria-label={`Color ${c}`}
                      onClick={() => setNewColor(c)}
                      className={`size-4 rounded-full ${DOT_CLASS[c]} ${newColor === c ? 'ring-2 ring-ring ring-offset-1' : ''}`}
                    />
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  )
}
