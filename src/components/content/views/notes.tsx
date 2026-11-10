'use client'

import * as React from 'react'
import { Plus, Pin, Search, Trash2, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { RichTextEditor } from '../editor/rich-text-editor'
import { safeJsonParse } from '@/components/safe-json'
import { toast } from 'sonner'

interface Note {
  id: string; title: string; body: string; isPinned: boolean; isPrivate: boolean
  updatedAt: string; authorId: string; mentions: string; hashtags: string
}

export function NotesView() {
  const [notes, setNotes] = React.useState<Note[] | null>(null)
  const [search, setSearch] = React.useState('')
  const [selected, setSelected] = React.useState<Note | null>(null)
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/content/notes?search=${encodeURIComponent(search)}`, { cache: 'no-store' })
      const data = await res.json()
      setNotes(data.notes ?? [])
    } catch {
      setNotes([])
    }
  }, [search])

  React.useEffect(() => { load() }, [load])

  const create = async () => {
    try {
      const res = await fetch('/api/content/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || 'Untitled', body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Note created')
      setTitle(''); setBody('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  const save = async () => {
    if (!selected) return
    try {
      const res = await fetch(`/api/content/notes/${selected.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Saved')
      load()
    } catch {
      toast.error('Save failed')
    }
  }

  const del = async (id: string) => {
    await fetch(`/api/content/notes/${id}`, { method: 'DELETE' })
    toast.success('Deleted')
    if (selected?.id === id) { setSelected(null); setTitle(''); setBody('') }
    load()
  }

  const openNote = (n: Note) => {
    setSelected(n)
    setTitle(n.title)
    setBody(n.body)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* Sidebar: notes list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Notes</h1>
          <Button size="sm" onClick={() => { setSelected(null); setTitle(''); setBody('') }}>
            <Plus className="mr-1 size-4" /> New
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes…" className="h-9 pl-8" />
        </div>
        <div className="space-y-2">
          {!notes ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : notes.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No notes yet</p>
          ) : (
            notes.map((n) => {
              const tags = safeJsonParse<string[]>(n.hashtags, [])
              return (
                <button
                  key={n.id}
                  onClick={() => openNote(n)}
                  className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/30 ${selected?.id === n.id ? 'border-primary bg-muted/30' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    {n.isPinned && <Pin className="size-3 shrink-0 text-amber-500" />}
                    <p className="flex-1 truncate text-sm font-medium">{n.title}</p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {n.body.replace(/<[^>]+>/g, '').slice(0, 80) || 'Empty'}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    {new Date(n.updatedAt).toLocaleDateString()}
                    {tags.slice(0, 2).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">#{t}</Badge>)}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Editor */}
      <Card className="flex flex-col">
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title"
            className="border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
          />
          {selected && (
            <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => del(selected.id)}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex-1">
          <RichTextEditor
            content={body}
            onChange={setBody}
            placeholder="Start writing… use @mentions and #hashtags"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setSelected(null); setTitle(''); setBody('') }}>Cancel</Button>
            <Button size="sm" onClick={selected ? save : create}>
              {selected ? 'Save' : 'Create note'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
