'use client'

import * as React from 'react'
import { Heart, MessageSquare, Send, Pin, Trash2, MoreHorizontal } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/store/auth'
import { safeJsonParse } from '@/components/safe-json'
import { toast } from 'sonner'

interface Post {
  id: string; body: string; authorId: string; createdAt: string
  isPinned: boolean; commentCount: number
  reactionCounts: Record<string, number>; myReactions: string[]
  mentions: string; hashtags: string
}

interface Props {
  relatedModule?: string
  relatedId?: string
}

const EMOJIS = ['👍', '❤️', '🎉', '😮', '😢', '🔥']

export function ActivityFeed({ relatedModule, relatedId }: Props) {
  const { user } = useAuth()
  const [posts, setPosts] = React.useState<Post[] | null>(null)
  const [composer, setComposer] = React.useState('')
  const [expandedComments, setExpandedComments] = React.useState<Set<string>>(new Set())
  const [comments, setComments] = React.useState<Record<string, { id: string; body: string; authorId: string; createdAt: string }[]>>({})

  const load = React.useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (relatedModule) params.set('relatedModule', relatedModule)
      if (relatedId) params.set('relatedId', relatedId)
      const res = await fetch(`/api/feed/posts?${params}`, { cache: 'no-store' })
      const data = await res.json()
      setPosts(data.posts ?? [])
    } catch {
      setPosts([])
    }
  }, [relatedModule, relatedId])

  React.useEffect(() => { load() }, [load])

  const post = async () => {
    if (!composer.trim()) return
    try {
      const res = await fetch('/api/feed/posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: composer, relatedModule, relatedId }),
      })
      if (!res.ok) throw new Error('Failed')
      setComposer('')
      toast.success('Posted')
      load()
    } catch {
      toast.error('Post failed')
    }
  }

  const react = async (postId: string, emoji: string) => {
    // Optimistic
    setPosts((prev) => prev?.map((p) => {
      if (p.id !== postId) return p
      const has = p.myReactions.includes(emoji)
      return {
        ...p,
        myReactions: has ? p.myReactions.filter((e) => e !== emoji) : [...p.myReactions, emoji],
        reactionCounts: {
          ...p.reactionCounts,
          [emoji]: (p.reactionCounts[emoji] ?? 0) + (has ? -1 : 1),
        },
      }
    }) ?? null)
    try {
      await fetch(`/api/feed/posts/${postId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      })
    } catch {
      load()
    }
  }

  const del = async (postId: string) => {
    await fetch(`/api/feed/posts/${postId}`, { method: 'DELETE' })
    toast.success('Deleted')
    load()
  }

  const loadComments = async (postId: string) => {
    try {
      const res = await fetch(`/api/feed/comments?postId=${postId}`, { cache: 'no-store' })
      const data = await res.json()
      setComments((c) => ({ ...c, [postId]: data.comments ?? [] }))
    } catch {}
  }

  const toggleComments = (postId: string) => {
    setExpandedComments((s) => {
      const next = new Set(s)
      if (next.has(postId)) next.delete(postId)
      else { next.add(postId); loadComments(postId) }
      return next
    })
  }

  const addComment = async (postId: string, body: string) => {
    if (!body.trim()) return
    await fetch('/api/feed/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, body }),
    })
    loadComments(postId)
    load()
  }

  return (
    <div className="space-y-4">
      {/* Composer */}
      <Card className="py-3">
        <CardContent className="flex items-center gap-2">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {user?.name?.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <Input
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post() } }}
            placeholder="Share an update… use @mentions and #hashtags"
            className="border-0 shadow-none focus-visible:ring-0"
          />
          <Button size="sm" onClick={post} disabled={!composer.trim()}>
            <Send className="size-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Posts */}
      {!posts ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : posts.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No posts yet. Start the conversation!</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => {
            const isMine = p.authorId === user?.id
            const initials = p.authorId.slice(-2).toUpperCase()
            const hashtags = safeJsonParse<string[]>(p.hashtags, [])
            return (
              <Card key={p.id} className="py-4">
                <CardHeader className="flex-row items-start gap-3 space-y-0 pb-3">
                  <Avatar className="size-9">
                    <AvatarFallback className="bg-muted text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">User {initials}</span>
                      {p.isPinned && <Pin className="size-3 text-amber-500" />}
                      <span className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{p.body}</p>
                    {/* Hashtags */}
                    {hashtags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {hashtags.map((t) => (
                          <Badge key={t} variant="secondary" className="text-[10px]">#{t}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {isMine && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7"><MoreHorizontal className="size-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="text-destructive" onClick={() => del(p.id)}>
                          <Trash2 className="mr-2 size-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  {/* Reactions */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {Object.entries(p.reactionCounts).filter(([, c]) => c > 0).map(([emoji, count]) => (
                      <button
                        key={emoji}
                        onClick={() => react(p.id, emoji)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                          p.myReactions.includes(emoji) ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
                        }`}
                      >
                        {emoji} <span className="font-medium">{count}</span>
                      </button>
                    ))}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-6">
                          <Heart className="size-3.5 text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {EMOJIS.map((e) => (
                          <DropdownMenuItem key={e} onClick={() => react(p.id, e)}>{e}</DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button variant="ghost" size="sm" className="ml-auto gap-1.5 text-xs" onClick={() => toggleComments(p.id)}>
                      <MessageSquare className="size-3.5" /> {p.commentCount}
                    </Button>
                  </div>

                  {/* Comments */}
                  {expandedComments.has(p.id) && (
                    <div className="space-y-2 border-t pt-2">
                      {(comments[p.id] ?? []).map((c) => (
                        <div key={c.id} className="flex gap-2">
                          <Avatar className="size-6">
                            <AvatarFallback className="bg-muted text-[10px]">{c.authorId.slice(-2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 rounded-lg bg-muted/50 p-2">
                            <p className="text-xs"><span className="font-medium">User {c.authorId.slice(-2).toUpperCase()}</span> <span className="text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span></p>
                            <p className="text-sm">{c.body}</p>
                          </div>
                        </div>
                      ))}
                      <CommentInput onSubmit={(body) => addComment(p.id, body)} />
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CommentInput({ onSubmit }: { onSubmit: (body: string) => void }) {
  const [value, setValue] = React.useState('')
  return (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) { onSubmit(value); setValue('') } }}
        placeholder="Write a comment…"
        className="h-8 text-sm"
      />
      <Button size="sm" variant="ghost" onClick={() => { if (value.trim()) { onSubmit(value); setValue('') } }}>
        <Send className="size-3.5" />
      </Button>
    </div>
  )
}
