'use client'

import * as React from 'react'
import {
  Sparkles, Send, X, Trash2, User, Loader2, ListTodo, CalendarDays, CalendarClock,
  Copy, Check, RotateCcw, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ChatMarkdown } from '@/components/ai/chat-markdown'
import { toast } from 'sonner'

interface Message {
  id: number
  role: string
  content: string
  /** ISO timestamp — client-generated for new messages; absent on server history rows. */
  timestamp?: string
  action?: { type: string; label: string }
  /** Marks an API-failure bubble so it renders the error style + Retry affordance. */
  error?: boolean
}

const SUGGESTED_PROMPTS = [
  'How many leads do we have?',
  'What is my pipeline value?',
  'Show my top open deals',
  'What is my win rate?',
  'Create a task to follow up with Acme tomorrow at 10am',
]

const CATEGORY_ICON = (type: string) =>
  type === 'event' ? <CalendarDays className="size-3" aria-hidden="true" />
    : type === 'csm' ? <CalendarClock className="size-3" aria-hidden="true" />
      : <ListTodo className="size-3" aria-hidden="true" />

const CATEGORY_LABEL = (type: string) =>
  type === 'event' ? 'Event scheduled' : type === 'csm' ? 'Next step set' : 'Task created'

/** Compact clock time for the little timestamp under each bubble. */
function formatTime(ts?: string): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Distance (px) from the bottom of the scroll viewport at which we consider the user "reading up". */
const SCROLL_PAUSE_THRESHOLD = 140
/** Max composer height ≈ 5 rows of text-sm/leading-5 plus vertical padding. */
const COMPOSER_MAX_HEIGHT = 120

export function ZiaChatbot({ autoOpen = false }: { autoOpen?: boolean } = {}) {
  const [open, setOpen] = React.useState(autoOpen)
  const [messages, setMessages] = React.useState<Message[]>([])
  const [input, setInput] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [confirmClear, setConfirmClear] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const toggleRef = React.useRef<HTMLButtonElement | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const historyLoadedRef = React.useRef(false)
  // Bumped when the chat is cleared so an in-flight history fetch can be discarded
  const clearEpochRef = React.useRef(0)
  const wasOpenRef = React.useRef(false)
  const idRef = React.useRef(0)
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // Autoscroll pause: set when the user scrolls up while a reply is streaming in;
  // cleared on their next send.
  const autoScrollPausedRef = React.useRef(false)
  const loadingRef = React.useRef(false)
  const nextId = () => ++idRef.current

  React.useEffect(() => { loadingRef.current = loading }, [loading])
  React.useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }, [])

  // ---- History load (race-safe) ----
  const loadHistory = React.useCallback(async () => {
    if (historyLoadedRef.current) return
    historyLoadedRef.current = true
    setHistoryLoading(true)
    const epoch = clearEpochRef.current
    try {
      const res = await fetch('/api/ai/chat', { cache: 'no-store' })
      if (!res.ok) throw new Error(`History request failed (${res.status})`)
      const data = await res.json().catch(() => null)
      if (epoch !== clearEpochRef.current) return // chat was cleared mid-load — discard stale history
      const history: Omit<Message, 'id'>[] = Array.isArray(data?.messages) ? data.messages : []
      // Merge safely: server history first, then anything already sent this session
      setMessages(prev => (prev.length > 0 ? [...history.map(m => ({ ...m, id: nextId() })), ...prev] : history.map(m => ({ ...m, id: nextId() }))))
    } catch {
      if (epoch !== clearEpochRef.current) return
      historyLoadedRef.current = false // allow a retry next time the panel opens
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (open && !historyLoadedRef.current) loadHistory()
  }, [open, loadHistory])

  // ---- Auto-scroll ----
  // Follows the newest message, EXCEPT while the user scrolls up during a
  // loading turn — paused until their next send.
  const prevCountRef = React.useRef(0)
  React.useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      const viewport = scrollRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
      if (!viewport) return
      const count = messages.length
      const firstLoad = prevCountRef.current === 0 && count > 0 // history just arrived — jump to newest
      const justSent = count > 0 && messages[count - 1]?.role === 'user' // own message / typing indicator
      prevCountRef.current = count
      if (firstLoad || justSent) {
        autoScrollPausedRef.current = false // a new send always resumes following
        viewport.scrollTop = viewport.scrollHeight
        return
      }
      if (autoScrollPausedRef.current) return
      viewport.scrollTop = viewport.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
  }, [messages, loading, open])

  // Pause autoscroll when the user deliberately scrolls up mid-load
  // (scrollTop-distance check). Programmatic scrolls land near the bottom, so
  // only a real upward scroll trips this.
  React.useEffect(() => {
    if (!open) return
    const viewport = scrollRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    const onScroll = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      if (loadingRef.current && distance > SCROLL_PAUSE_THRESHOLD) autoScrollPausedRef.current = true
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [open])

  // Auto-grow the composer textarea (1 → ~5 rows)
  React.useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
  }, [input])

  // Focus the input when the panel opens; restore focus to the toggle button on close
  React.useEffect(() => {
    if (open) {
      wasOpenRef.current = true
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false
      toggleRef.current?.focus()
    }
  }, [open])

  // Cancel any in-flight request if the component ever unmounts
  React.useEffect(() => () => abortRef.current?.abort(), [])

  const closePanel = React.useCallback(() => {
    abortRef.current?.abort()
    setOpen(false)
  }, [])

  /**
   * POST the message and append the reply. Does NOT touch the user bubble —
   * send() adds it, retry() reuses the one already in the transcript.
   */
  const runCompletion = async (text: string) => {
    setLoading(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        signal: controller.signal,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const reason = (typeof data?.error === 'string' && data.error.trim())
          || `Request failed (HTTP ${res.status})`
        setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: `Something went wrong: ${reason}`, error: true, timestamp: new Date().toISOString() }])
        return
      }
      const reply = typeof data?.response === 'string' && data.response.trim()
        ? data.response
        : 'I received an empty response. Please try again.'
      const action = data?.action && typeof data.action === 'object' && typeof data.action.type === 'string'
        ? { type: String(data.action.type), label: String(data.action.label ?? '') }
        : undefined
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: reply, action, timestamp: new Date().toISOString() }])
    } catch (e) {
      if (controller.signal.aborted) {
        // Panel closed or chat cleared mid-request — drop the optimistic user message
        setMessages(prev => {
          const idx = prev.findLastIndex(m => m.role === 'user')
          return idx === -1 ? prev : [...prev.slice(0, idx), ...prev.slice(idx + 1)]
        })
        return
      }
      const reason = e instanceof Error && e.message ? e.message : 'network error'
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: `Something went wrong: ${reason}`, error: true, timestamp: new Date().toISOString() }])
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setLoading(false) // typing indicator can never get stuck
    }
  }

  const send = async (rawText?: string) => {
    const text = (rawText ?? input).trim()
    if (!text || loading || historyLoading) return
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: text, timestamp: new Date().toISOString() }])
    setInput('')
    await runCompletion(text)
  }

  /** Resend the last user message after an API-failure bubble. */
  const retry = async () => {
    if (loading) return
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    // Drop everything after the last user message (the trailing error bubble)
    setMessages(prev => {
      const idx = prev.findLastIndex(m => m.role === 'user')
      return idx === -1 ? prev.filter(m => !m.error) : prev.slice(0, idx + 1)
    })
    await runCompletion(lastUser.content)
  }

  const clearChat = async () => {
    if (clearing) return
    setConfirmClear(false)
    setClearing(true)
    abortRef.current?.abort() // cancel any in-flight reply first
    setMessages([])
    autoScrollPausedRef.current = false
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The API validates body.message BEFORE handling action==='clear' (it 400s on a
        // missing message), so a placeholder is required. The route returns on the clear
        // branch before ever calling chat(), so this message never reaches the LLM.
        body: JSON.stringify({ message: '__clear__', action: 'clear' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error((typeof data?.error === 'string' && data.error) || `Clear failed (${res.status})`)
      }
      toast.success('Chat cleared')
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Could not clear the chat. Please try again.')
    } finally {
      setClearing(false)
    }
  }

  /** Copy the newest agent response (markdown source) to the clipboard. */
  const lastAgentMessage = React.useMemo(
    () => [...messages].reverse().find(m => m.role === 'assistant' && !m.error),
    [messages],
  )
  const copyResponse = async () => {
    if (!lastAgentMessage) return
    try {
      await navigator.clipboard.writeText(lastAgentMessage.content)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy to clipboard. Please try again.')
    }
  }

  return (
    <>
      {/* Floating button (56px — comfortable touch target; hidden while the panel is open) */}
      {!open && (
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 animate-in fade-in slide-in-from-bottom-2 duration-200 sm:bottom-6 sm:right-6"
          aria-label="Open Zia AI assistant"
        >
          <Sparkles className="size-6" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Zia AI assistant"
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              closePanel()
            }
          }}
          className="zia-chat fixed bottom-4 right-4 z-40 flex h-[min(600px,calc(100dvh_-_6rem))] w-[calc(100vw_-_2rem)] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200 sm:bottom-6 sm:right-6 sm:w-96"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b p-3">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Ask Zia</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="relative flex size-2" aria-hidden="true">
                    <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${loading ? 'animate-ping bg-amber-500' : 'animate-pulse bg-emerald-500'}`} />
                    <span className={`relative inline-flex size-2 rounded-full ${loading ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  </span>
                  <span className="sr-only">{loading ? 'Zia is thinking' : 'Zia is idle'}</span>
                  {loading ? 'Thinking…' : 'Your CRM assistant'}
                </p>
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost" size="icon" className="size-8"
                onClick={copyResponse} disabled={!lastAgentMessage || copied}
                title="Copy response" aria-label="Copy last response"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              </Button>
              <Button
                variant="ghost" size="icon" className="size-8"
                onClick={() => setConfirmClear(true)} disabled={clearing}
                title="Clear chat" aria-label="Clear conversation"
              >
                {clearing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </Button>
              <Button
                variant="ghost" size="icon" className="size-8"
                onClick={closePanel}
                title="Close" aria-label="Close chat"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {/* Messages
              NOTE: min-h-0 + overflow-hidden are REQUIRED on the Radix ScrollArea root.
              Without them the flex item's automatic minimum size equals its content
              height, so a long conversation pushes the composer out of the fixed-height
              panel (clipped by overflow-hidden) and the viewport never scrolls. */}
          <ScrollArea
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-hidden [&_[data-radix-scroll-area-viewport]]:overscroll-contain"
          >
            <div className="p-3">
            {messages.length === 0 && historyLoading && (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                <span className="sr-only">Loading conversation…</span>
              </div>
            )}
            {messages.length === 0 && !historyLoading && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Sparkles className="size-8 text-primary" />
                <p className="text-sm font-medium">Hi! I&apos;m Zia, your AI assistant.</p>
                <p className="text-xs text-muted-foreground">I can see your live CRM — ask about leads, pipeline, deals, tasks or cadence. Or tell me to create tasks and events:</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {SUGGESTED_PROMPTS.map(p => (
                    <button
                      key={p} type="button" disabled={loading}
                      onClick={() => send(p)}
                      className="min-h-11 rounded-full border px-3 py-2 text-xs transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-3" aria-live="polite" aria-busy={loading}>
              {messages.map((msg) => {
                const isUser = msg.role === 'user'
                const time = formatTime(msg.timestamp)
                return (
                  <div key={msg.id} className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
                    {/* Avatar */}
                    <div className={`flex size-7 shrink-0 items-center justify-center rounded-full ${isUser ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
                      {isUser ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}
                    </div>
                    <div className={`flex max-w-[85%] min-w-0 flex-col gap-0.5 ${isUser ? 'items-end' : 'items-start'}`}>
                      {msg.error ? (
                        /* API-failure bubble with retry */
                        <div className="flex flex-col gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm">
                          <p className="flex items-start gap-1.5 break-words">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                            {msg.content}
                          </p>
                          <Button
                            variant="outline" size="sm"
                            className="h-8 gap-1.5 self-start border-destructive/40 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={retry} disabled={loading}
                          >
                            <RotateCcw className="size-3" /> Retry
                          </Button>
                        </div>
                      ) : (
                        <div className={`rounded-lg p-2.5 text-sm ${isUser ? 'border border-primary/25 bg-primary/15' : 'bg-muted'}`}>
                          {!isUser && msg.action && (
                            <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400" title={msg.action.label}>
                              {CATEGORY_ICON(msg.action.type)}
                              {CATEGORY_LABEL(msg.action.type)}
                            </span>
                          )}
                          {isUser
                            ? <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                            : <ChatMarkdown text={msg.content} />}
                        </div>
                      )}
                      {time && <span className="px-1 text-[10px] leading-none text-muted-foreground">{time}</span>}
                    </div>
                  </div>
                )
              })}
              {loading && (
                <div className="flex gap-2">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="size-3.5" /></div>
                  <div className="rounded-lg bg-muted p-2.5" aria-label="Zia is typing">
                    <div className="flex gap-1">
                      <span className="size-2 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '0ms' }} />
                      <span className="size-2 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '150ms' }} />
                      <span className="size-2 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
            </div>
          </ScrollArea>

          {/* Composer — pinned, auto-expanding (Enter = newline, Ctrl/Cmd+Enter = send) */}
          <div className="shrink-0 border-t p-3">
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.nativeEvent.isComposing) return
                  e.preventDefault()
                  send()
                }}
                placeholder={historyLoading ? 'Loading conversation…' : 'Ask about leads, deals, numbers…'}
                aria-label="Message Zia AI"
                disabled={loading}
                rows={1}
                className="max-h-[120px] min-h-[44px] flex-1 resize-none py-2.5 text-sm"
              />
              <Button
                size="icon" className="size-11 shrink-0"
                onClick={() => send()} disabled={loading || historyLoading || !input.trim()} aria-label="Send message"
              >
                <Send className="size-4" />
              </Button>
            </div>
            <p className="mt-1 px-1 text-[10px] text-muted-foreground">Ctrl+Enter to send</p>
          </div>
        </div>
      )}

      {/* Clear-chat confirmation (Radix portal — sits above the panel) */}
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the whole Zia history for your account. Tasks and events Zia already created are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={clearChat}
            >
              {clearing ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Trash2 className="mr-1.5 size-4" />}
              Clear chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
