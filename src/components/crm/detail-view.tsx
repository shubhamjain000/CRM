'use client'

import * as React from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Lock, Unlock, Printer, Clock, MessageSquare, FileText, Link as LinkIcon, Activity as ActivityIcon, StickyNote, Pencil, Mail as MailIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PhoneLink } from './call-dialer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { NOTE_KIND_ORDER, noteKindMeta } from './note-kinds'
import { RecordTags } from './record-tags'
import { useFieldSecurity, securityKey } from './use-field-security'
import { useRecordNav } from '@/store/record-nav'
import { CALL_LOGGED_EVENT } from '@/lib/call-tracking'
import { useRealtime } from '@/components/productivity/realtime-provider'
import { toast } from 'sonner'

interface ActivityItem {
  id: string; type: 'activity' | 'note'; action?: string; body?: string
  description?: string | null; createdAt: string; recordName?: string
}

interface NoteItem {
  id: string; kind: string; body: string; createdAt: string
}

/** One extra field in an additive detail section — `node` is a fully custom renderable. */
export interface DetailSectionField {
  key: string
  label: string
  node: React.ReactNode
}

/** Extra info card rendered below the existing "Record details" card (Overview tab). */
export interface DetailSection {
  title: string
  fields: DetailSectionField[]
  /** Optional full-width custom block (e.g. the Zoho-style listing history table).
   *  When present it replaces the label/value fields grid entirely. */
  node?: React.ReactNode
}

interface Props {
  module: string
  recordId: string
  recordName: string
  onBack: () => void
  onEdit?: () => void
  fields: { key: string; label: string; value: unknown; editable?: boolean; /** Display name used for tel: logs when the value is a phone (e.g. POC name on accounts). */ phoneName?: string }[]
  onFieldEdit?: (field: string, value: string) => Promise<void>
  relatedLinks?: { label: string; count: number; onClick?: () => void }[]
  /** Optional module-specific card rendered above the tabs (e.g. CSM cadence on contacts). */
  cadence?: React.ReactNode
  /** When provided, the detail header shows Previous / Next arrows and the
   *  ArrowLeft / ArrowRight keys move through the module's records. */
  onNavigateRecord?: (id: string) => void
  /** Extra header actions (Email, WhatsApp, Change owner…) rendered after Edit. */
  headerActions?: React.ReactNode
  /** Optional additive sections rendered as additional Cards below the fields card. */
  sections?: DetailSection[]
  /** Free-form additive cards (e.g. AI lead score) rendered after `sections`. */
  extraCards?: React.ReactNode
  /** When set, an additive "Emails" tab lists mail to/from this address (e.g. the contact's first email). */
  emailAddress?: string
  /** Optional override for the record linkage used by the Emails tab queries (defaults to module/recordId). */
  emailRecord?: { id: string; module: string }
}

/** Phone fields render as tap-to-call dialer links. */
function isPhoneField(f: { key: string; value: unknown }): boolean {
  const v = String(f.value ?? '').trim()
  if (!v) return false
  if (/phone|mobile|whatsapp/i.test(f.key)) return true
  // Value looks like a phone number: mostly digits/spaces/dashes/parens, 7+ digits
  return /^\+?[\d\s()-]{7,20}$/.test(v) && v.replace(/\D/g, '').length >= 7
}

interface CustomFieldDef {
  id: string; label: string; apiName: string; fieldType: string
  fieldOptions: Record<string, unknown>
}

function formatCustomValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.length > 0 ? v.join(', ') : '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
  }
  return String(v)
}

// --- Additive "Emails" tab (contacts) ---------------------------------------

interface RecordEmailItem {
  id: string; direction: string; fromAddress: string; subject: string
  bodyText: string; bodyHtml: string
  receivedAt: string | null; sentAt: string | null; createdAt: string
}

const emailDate = (e: RecordEmailItem) => new Date(e.receivedAt || e.sentAt || e.createdAt).getTime()

/**
 * Emails linked to the record (relatedModule/relatedId) PLUS messages whose
 * from/to/cc contains the record's email address — merged, deduped by id,
 * newest first. Server exposes both filters additively via /api/email/messages.
 */
function RecordEmails({ module, recordId, emailAddress }: { module: string; recordId: string; emailAddress: string }) {
  const [items, setItems] = React.useState<RecordEmailItem[] | null>(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    setItems(null)
    setError('')
    const load = (params: Record<string, string>) =>
      fetch(`/api/email/messages?${new URLSearchParams(params).toString()}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load emails'))))
    Promise.all([
      load({ relatedModule: module, relatedId: recordId, limit: '50' }),
      load({ address: emailAddress, limit: '50' }),
    ])
      .then(([byRecord, byAddress]) => {
        if (cancelled) return
        const merged = new Map<string, RecordEmailItem>()
        for (const e of [...(byRecord?.emails ?? []), ...(byAddress?.emails ?? [])]) {
          if (e?.id && !merged.has(e.id)) merged.set(e.id, e as RecordEmailItem)
        }
        setItems([...merged.values()].sort((a, b) => emailDate(b) - emailDate(a)))
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load emails') })
    return () => { cancelled = true }
  }, [module, recordId, emailAddress])

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-red-500">{error}</CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-0">
        {!items ? (
          <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No emails yet — messages to or from {emailAddress} will appear here.
          </div>
        ) : (
          <ul className="divide-y max-h-[60vh] overflow-y-auto">
            {items.map((e) => (
              <li key={e.id} className="flex gap-3 p-3">
                <Badge variant={e.direction === 'outbound' ? 'default' : 'secondary'} className="mt-0.5 h-fit shrink-0 text-[10px] uppercase">
                  {e.direction === 'outbound' ? 'Out' : 'In'}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{e.subject || '(no subject)'}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {new Date(e.receivedAt || e.sentAt || e.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {e.direction === 'outbound' ? `To ${e.fromAddress}` : `From ${e.fromAddress}`}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {(e.bodyText || e.bodyHtml.replace(/<[^>]+>/g, ' ')).trim().slice(0, 200) || '—'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function DetailView({ module, recordId, recordName, onBack, onEdit, fields, onFieldEdit, relatedLinks, cadence, onNavigateRecord, headerActions, sections, extraCards, emailAddress, emailRecord }: Props) {
  const [editing, setEditing] = React.useState<string | null>(null)
  const [editValue, setEditValue] = React.useState('')
  const [timeline, setTimeline] = React.useState<Record<string, ActivityItem[]> | null>(null)
  const [noteBody, setNoteBody] = React.useState('')
  const [noteKind, setNoteKind] = React.useState('general')
  const [notes, setNotes] = React.useState<NoteItem[] | null>(null)
  const [noteFilter, setNoteFilter] = React.useState<string>('all')
  const [addingNote, setAddingNote] = React.useState(false)
  const [locked, setLocked] = React.useState(false)
  const [customDefs, setCustomDefs] = React.useState<CustomFieldDef[] | null>(null)
  const [customValues, setCustomValues] = React.useState<Record<string, unknown> | null>(null)

  // Field security (Tier 3): hidden fields never render; read-only fields stay
  // visible but their inline edit is disabled with a tooltip. Degrades to "no
  // restrictions" while loading / on failure — the UI is never blocked.
  const { hiddenFor, isReadOnly } = useFieldSecurity()
  const hiddenSet = React.useMemo(
    () => hiddenFor(module),
    [module, hiddenFor],
  )
  const fieldReadOnly = (key: string) => isReadOnly(module, securityKey(key))
  const secFields = React.useMemo(
    () => fields.filter((f) => !hiddenSet.has(securityKey(f.key))),
    [fields, hiddenSet],
  )

  // "lead" → "Leads" — label for the sticky back button.
  const moduleLabel = `${module.charAt(0).toUpperCase() + module.slice(1)}s`

  // Scroll management (UX): opening a record always starts at the top of the
  // main scroll area; going Back restores the exact position the list was
  // scrolled to. Search/filter state survives on its own because the list
  // view keeps its React state across the detail round-trip.
  React.useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    const saved = main.scrollTop
    main.scrollTop = 0
    return () => {
      requestAnimationFrame(() => { main.scrollTop = saved })
    }
  }, [])

  // Prev/Next record switches also start from the top.
  React.useEffect(() => {
    const main = document.querySelector('main')
    if (main) main.scrollTop = 0
  }, [recordId])

  // --- Previous / Next record navigation ---------------------------------
  const navList = useRecordNav((s) => s.lists[module])
  const setNavList = useRecordNav((s) => s.setList)
  const navIndex = navList ? navList.indexOf(recordId) : -1
  const hasPrev = navIndex > 0
  const hasNext = navIndex >= 0 && navIndex < navList.length - 1

  // Make sure we know the module's record order (cached in the store after the
  // first fetch; deep-links fetch it on demand and always include this record).
  React.useEffect(() => {
    if (!onNavigateRecord || (navList && navList.includes(recordId))) return
    let cancelled = false
    fetch(`/api/crm/${module}s?limit=200`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.items)) return
        const ids: string[] = d.items.map((i: { id: string }) => i.id)
        setNavList(module, ids.includes(recordId) ? ids : [recordId, ...ids])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [module, recordId, navList, setNavList, onNavigateRecord])

  const goRecord = React.useCallback((dir: 1 | -1) => {
    if (navIndex < 0 || !navList || !onNavigateRecord) return
    const nextId = navList[navIndex + dir]
    if (nextId) onNavigateRecord(nextId)
  }, [navIndex, navList, onNavigateRecord])

  // ArrowLeft / ArrowRight move between records — ignored while typing in a
  // field or when any dialog is open.
  React.useEffect(() => {
    if (!onNavigateRecord || navIndex < 0) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      goRecord(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onNavigateRecord, navIndex, goRecord])

  const loadNotes = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/notes?module=${module}&recordId=${recordId}`, { cache: 'no-store' })
      const data = await res.json()
      setNotes(Array.isArray(data.notes) ? data.notes : [])
    } catch {
      setNotes([])
    }
  }, [module, recordId])

  const loadTimeline = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/activities?module=${module}&recordId=${recordId}`, { cache: 'no-store' })
      const data = await res.json()
      setTimeline(data.groups ?? {})
    } catch {
      setTimeline({})
    }
  }, [module, recordId])

  React.useEffect(() => {
    loadTimeline()
    loadNotes()
    // Track view
    fetch('/api/crm/recent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module, recordId, recordName }),
    }).catch(() => {})
  }, [loadTimeline, loadNotes, module, recordId, recordName])

  // --- Live call updates (auto-logged calls append to this timeline) -------
  // Debounced reload so a burst of events (save + realtime echo) fetches once.
  const timelineReloadRef = React.useRef(loadTimeline)
  timelineReloadRef.current = loadTimeline
  const timelineTimerRef = React.useRef<number | null>(null)
  const requestTimelineReload = React.useCallback(() => {
    if (timelineTimerRef.current !== null) window.clearTimeout(timelineTimerRef.current)
    timelineTimerRef.current = window.setTimeout(() => {
      timelineTimerRef.current = null
      void timelineReloadRef.current()
    }, 500)
  }, [])

  // (a) Same-tab signal: CallTracker dispatches CALL_LOGGED_EVENT after an
  // auto-log (detail carries relatedModule/relatedId when known).
  React.useEffect(() => {
    const onCallLogged = (e: Event) => {
      const detail = (e as CustomEvent<{ relatedModule?: string; relatedId?: string }>).detail
      // Events without detail (older dispatchers) always refresh; otherwise
      // only when the call targets the record currently open.
      if (detail?.relatedModule && detail.relatedModule !== module) return
      if (detail?.relatedId && detail.relatedId !== recordId) return
      requestTimelineReload()
    }
    window.addEventListener(CALL_LOGGED_EVENT, onCallLogged)
    return () => window.removeEventListener(CALL_LOGGED_EVENT, onCallLogged)
  }, [module, recordId, requestTimelineReload])

  // (b) Cross-tab/device signal: the server pushes 'call.logged' over the
  // realtime socket (RealtimeProvider fans it into `notifications`).
  const realtime = useRealtime()
  const seenRealtimeRef = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    const notifications = realtime?.notifications ?? []
    for (const n of notifications) {
      if (seenRealtimeRef.current.has(n.id)) continue
      seenRealtimeRef.current.add(n.id)
      if (n.event !== 'call.logged') continue
      const d = n.data as { relatedModule?: string; relatedId?: string } | undefined
      if (d?.relatedModule && d.relatedModule !== module) continue
      if (d?.relatedId && d.relatedId !== recordId) continue
      requestTimelineReload()
    }
    // Keep the seen-set bounded — old ids never re-arrive.
    if (seenRealtimeRef.current.size > 200) seenRealtimeRef.current = new Set()
  }, [realtime?.notifications, module, recordId, requestTimelineReload])

  // Load custom field defs + this record's custom values
  React.useEffect(() => {
    if (!module || !recordId) return
    const ctrl = new AbortController()
    setCustomDefs(null)
    setCustomValues(null)
    Promise.all([
      fetch(`/api/crm/custom-fields?module=${module}`, { cache: 'no-store', signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { fields: [] }))
        .catch(() => ({ fields: [] })),
      fetch(`/api/crm/${module}s/${recordId}`, { cache: 'no-store', signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([defsRes, record]) => {
      const defs: CustomFieldDef[] = Array.isArray(defsRes?.fields) ? defsRes.fields : []
      setCustomDefs(defs)
      setCustomValues(record?.customFields && typeof record.customFields === 'object' ? record.customFields : {})
    })
    return () => ctrl.abort()
  }, [module, recordId])

  const commitField = async (field: string) => {
    if (!onFieldEdit) return
    try {
      await onFieldEdit(field, editValue)
      toast.success('Saved')
    } catch {
      toast.error('Save failed')
    }
    setEditing(null)
  }

  const addNote = async () => {
    if (!noteBody.trim()) return
    setAddingNote(true)
    try {
      const res = await fetch('/api/crm/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module, recordId, body: noteBody.trim(), kind: noteKind }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Failed')
      toast.success(`Note added — ${noteKindMeta(noteKind).label}`)
      setNoteBody('')
      setNoteKind('general')
      loadTimeline()
      loadNotes()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add note')
    } finally {
      setAddingNote(false)
    }
  }

  const visibleNotes = React.useMemo(
    () => (notes ?? []).filter((n) => noteFilter === 'all' || n.kind === noteFilter),
    [notes, noteFilter],
  )

  const noteKindCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of notes ?? []) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1)
    return counts
  }, [notes])

  const totalActivities = timeline ? Object.values(timeline).reduce((s, g) => s + g.length, 0) : 0

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Sticky record header — the tappable "Back to <Module>" bar stays
          pinned to the top of the screen on EVERY size (most important on
          phones, where it used to scroll away behind content). The actions
          cluster wraps to a second line when the viewport is narrow, so
          nothing is ever cut off. */}
      <div className="sticky top-0 z-30 -mx-4 border-b border-border/70 bg-canvas/90 px-4 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Button variant="ghost" size="sm" className="shrink-0 font-medium max-sm:h-9" onClick={onBack}>
              <ArrowLeft className="size-4" /> Back to {moduleLabel}
            </Button>
            <div className="min-w-0 truncate text-sm text-muted-foreground">
              <span className="hidden sm:inline">{module} / </span>
              <span className="font-medium text-foreground">{recordName}</span>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {onNavigateRecord && navIndex >= 0 && navList && navList.length > 1 && (
            <div className="flex items-center gap-0.5 rounded-lg border px-0.5 py-0.5" role="navigation" aria-label="Record navigation">
              <Button variant="ghost" size="icon" className="size-7" disabled={!hasPrev} onClick={() => goRecord(-1)} aria-label="Previous record" title="Previous record (← key)">
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground" aria-label={`Record ${navIndex + 1} of ${navList.length}`}>
                {navIndex + 1} / {navList.length}
              </span>
              <Button variant="ghost" size="icon" className="size-7" disabled={!hasNext} onClick={() => goRecord(1)} aria-label="Next record" title="Next record (→ key)">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
          {headerActions && <div className="flex shrink-0 items-center gap-1">{headerActions}</div>}
          {onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit} title="Open full edit form">
              <Pencil className="mr-1.5 size-3.5" /> Edit
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-8" onClick={() => { setLocked(!locked); toast.info(locked ? 'Record unlocked' : 'Record locked') }}>
            {locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="hidden size-8 sm:inline-flex" onClick={() => toast.info('Print view')}><Printer className="size-4" /></Button>
          </div>
        </div>
      </div>

      {/* Zoho-style record tags (leads / contacts / accounts / deals) */}
      <RecordTags module={module} recordId={recordId} />

      <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_280px]">
        {/* Main: cadence slot + tabs */}
        <div className="flex min-w-0 flex-col gap-4">
          {cadence}
          <Tabs defaultValue="overview" className="flex flex-col">
          <TabsList className="ribbon max-w-full justify-start sm:w-fit">
            <TabsTrigger value="overview"><ActivityIcon className="mr-1.5 size-3.5" /> Overview</TabsTrigger>
            <TabsTrigger value="activities"><Clock className="mr-1.5 size-3.5" /> Activities {totalActivities > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{totalActivities}</Badge>}</TabsTrigger>
            <TabsTrigger value="notes"><MessageSquare className="mr-1.5 size-3.5" /> Notes</TabsTrigger>
            <TabsTrigger value="related"><LinkIcon className="mr-1.5 size-3.5" /> Related</TabsTrigger>
            {emailAddress && (
              <TabsTrigger value="emails"><MailIcon className="mr-1.5 size-3.5" /> Emails</TabsTrigger>
            )}
          </TabsList>

          {/* Overview: inline-editable fields */}
          <TabsContent value="overview" className="flex-1 space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Record details</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                {secFields.map((f) => {
                  // Read-only for the caller's role: value stays visible, the
                  // inline edit is disabled and a lock + tooltip explain why.
                  const ro = !!f.editable && fieldReadOnly(f.key)
                  return (
                    // min-w-0 on the grid cell + truncate on the value keeps long
                    // emails/URLs from pushing the two-column layout outward.
                    <div key={f.key} className="min-w-0 space-y-1">
                      <p className="flex items-center gap-1 truncate text-xs uppercase tracking-wide text-muted-foreground">
                        {f.label}
                        {ro && <Lock className="size-3 shrink-0" aria-hidden />}
                      </p>
                      {editing === f.key && f.editable && !locked && !ro ? (
                        <Input
                          autoFocus
                          type={/email/i.test(f.key) ? 'email' : undefined}
                          className={/email/i.test(f.key) ? 'overflow-hidden [text-overflow:ellipsis] focus:[text-overflow:clip]' : undefined}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => commitField(f.key)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitField(f.key)
                            if (e.key === 'Escape') setEditing(null)
                          }}
                        />
                      ) : ro ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="flex min-w-0 cursor-not-allowed items-center gap-1.5 rounded px-1 py-0.5 text-sm"
                              title="Read only for your role"
                            >
                              <span className="min-w-0 truncate">{String(f.value ?? '—') || '—'}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>Read only for your role</TooltipContent>
                        </Tooltip>
                      ) : f.key === 'description' ? (
                        /* Description carries multi-line folded import extras
                         * ("Header: value" lines) — render pre-line, never truncated. */
                        editing === f.key && f.editable && !locked && !ro ? (
                          <Textarea
                            autoFocus
                            className="min-h-24 text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => commitField(f.key)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitField(f.key)
                              if (e.key === 'Escape') setEditing(null)
                            }}
                          />
                        ) : (
                          <div
                            className={`min-w-0 whitespace-pre-line rounded px-1 py-0.5 text-sm ${f.editable && !locked ? 'cursor-text hover:bg-muted' : ''}`}
                            title={String(f.value ?? '') || undefined}
                            onClick={() => {
                              if (f.editable && !locked && onFieldEdit) {
                                setEditing(f.key)
                                setEditValue(String(f.value ?? ''))
                              }
                            }}
                          >
                            {String(f.value ?? '—') || '—'}
                          </div>
                        )
                      ) : isPhoneField(f) ? (
                        <div className="min-w-0 rounded px-1 py-0.5 text-sm">
                          <PhoneLink
                            phone={String(f.value)}
                            name={'phoneName' in f && typeof f.phoneName === 'string' && f.phoneName ? f.phoneName : recordName}
                            module={module}
                            recordId={recordId}
                          />
                        </div>
                      ) : (
                        <div
                          className={`min-w-0 truncate rounded px-1 py-0.5 text-sm ${f.editable && !locked ? 'cursor-text hover:bg-muted' : ''}`}
                          title={f.value === null || f.value === undefined || String(f.value) === '' ? undefined : String(f.value)}
                          onClick={() => {
                            if (f.editable && !locked && onFieldEdit) {
                              setEditing(f.key)
                              setEditValue(String(f.value ?? ''))
                            }
                          }}
                        >
                          {String(f.value ?? '—') || '—'}
                        </div>
                      )}
                    </div>
                  )
                })}
              </CardContent>

              {customDefs && customDefs.length > 0 && (
                <CardContent className="border-t pt-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom fields</p>
                  <div className="grid grid-cols-2 gap-4">
                    {customDefs.map((def) => {
                      const v = customValues?.[def.apiName]
                      const isEmpty = v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
                      return (
                        <div key={def.apiName} className="space-y-1">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">{def.label}</p>
                          <div className="text-sm">{isEmpty ? '—' : formatCustomValue(v)}</div>
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Edit custom fields via the full record form (Edit button above).
                  </p>
                </CardContent>
              )}
            </Card>

            {/* Additive module-specific sections (e.g. Listing Intelligence on contacts) */}
            {(sections ?? []).map((s) => (
              <Card key={s.title}>
                <CardHeader><CardTitle className="text-base">{s.title}</CardTitle></CardHeader>
                {s.node ? (
                  /* Full-width custom block (Zoho-style table) — no label/value grid. */
                  <CardContent className="pb-4">{s.node}</CardContent>
                ) : (
                  <CardContent className="grid grid-cols-2 gap-4">
                    {s.fields.map((f) => (
                      <div key={f.key} className="min-w-0 space-y-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</p>
                        <div className="text-sm">{f.node}</div>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            ))}

            {/* Free-form additive cards (e.g. AI lead score on leads) */}
            {extraCards}
          </TabsContent>

          {/* Activities timeline */}
          <TabsContent value="activities" className="flex-1">
            <Card>
              <CardContent className="p-0">
                {!timeline ? (
                  <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : totalActivities === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">No activity yet</div>
                ) : (
                  <div className="max-h-[60vh] overflow-y-auto p-4">
                    {Object.entries(timeline).map(([group, items]) => (
                      <div key={group} className="mb-6">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
                        <ul className="space-y-2">
                          {items.map((item) => (
                            <li key={item.id} className="flex gap-3 rounded-lg border p-3">
                              <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                {item.type === 'note' ? <MessageSquare className="size-3" /> : <ActivityIcon className="size-3" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm">
                                  {item.type === 'note' ? item.body : (
                                    <span><span className="font-medium">{item.action}</span> {item.description ? `— ${item.description}` : ''}</span>
                                  )}
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notes */}
          <TabsContent value="notes" className="flex-1 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><StickyNote className="size-4 text-primary" /> Add note</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[260px_1fr]">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="note-kind">Note type</label>
                    <Select value={noteKind} onValueChange={setNoteKind}>
                      <SelectTrigger id="note-kind" aria-label="Note type">
                        <SelectValue placeholder="Choose type" />
                      </SelectTrigger>
                      <SelectContent>
                        {['General', 'Touchpoint cadence', 'Interactions', 'Commercial'].map((group) => (
                          <SelectGroup key={group}>
                            <SelectLabel className="text-xs text-muted-foreground">{group}</SelectLabel>
                            {NOTE_KIND_ORDER
                              .filter((k) => noteKindMeta(k).group === group)
                              .map((k) => (
                                <SelectItem key={k} value={k}>
                                  <span className="flex items-center gap-2">
                                    <span className={`inline-block size-2 rounded-full ${noteKindMeta(k).dot}`} />
                                    {noteKindMeta(k).label}
                                  </span>
                                </SelectItem>
                              ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="note-body">Note</label>
                    <Textarea
                      id="note-body"
                      value={noteBody}
                      onChange={(e) => setNoteBody(e.target.value)}
                      placeholder={`Write a ${noteKindMeta(noteKind).label.toLowerCase()}… supports @mentions and #hashtags`}
                      rows={3}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Tip: use the cadence types (Day 0, Day 1 reconnect…) to track your outreach rhythm.
                  </p>
                  <Button size="sm" onClick={addNote} disabled={!noteBody.trim() || addingNote}>
                    {addingNote ? 'Saving…' : 'Add note'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Notes list */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>Notes {notes && notes.length > 0 && <Badge variant="secondary" className="ml-1.5 text-xs">{notes.length}</Badge>}</span>
                  {noteKindCounts.size > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setNoteFilter('all')}
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${noteFilter === 'all' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
                      >
                        All ({notes?.length ?? 0})
                      </button>
                      {[...noteKindCounts.entries()].map(([k, count]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setNoteFilter(noteFilter === k ? 'all' : k)}
                          className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${noteFilter === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
                        >
                          {noteKindMeta(k).label} ({count})
                        </button>
                      ))}
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!notes ? (
                  <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
                ) : visibleNotes.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {notes.length === 0 ? 'No notes yet — add the first note above.' : 'No notes of this type.'}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {visibleNotes.map((n) => {
                      const meta = noteKindMeta(n.kind)
                      return (
                        <li key={n.id} className="rounded-lg border p-3">
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={`gap-1.5 text-[11px] ${meta.class}`}>
                              <span className={`inline-block size-1.5 rounded-full ${meta.dot}`} />
                              {meta.label}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Related */}
          <TabsContent value="related" className="flex-1">
            <Card>
              <CardContent className="p-4">
                {!relatedLinks || relatedLinks.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No related records</p>
                ) : (
                  <ul className="space-y-2">
                    {relatedLinks.map((r) => (
                      <li key={r.label} className="flex items-center justify-between rounded-lg border p-3">
                        <span className="text-sm font-medium">{r.label}</span>
                        <Badge variant="secondary">{r.count}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Emails (additive, only when the record has an email address) */}
          {emailAddress && (
            <TabsContent value="emails" className="flex-1">
              <RecordEmails
                module={emailRecord?.module ?? module}
                recordId={emailRecord?.id ?? recordId}
                emailAddress={emailAddress}
              />
            </TabsContent>
          )}
        </Tabs>
        </div>

        {/* Right panel: quick info */}
        <Card className="h-fit">
          <CardHeader><CardTitle className="text-sm">Quick info</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Module</span><span className="capitalize">{module}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">ID</span><span className="font-mono text-xs">{recordId.slice(-8)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Activities</span><span>{totalActivities}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span>
              {locked ? <Badge variant="outline" className="border-amber-500/40 text-amber-600">Locked</Badge> : <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Editable</Badge>}
            </div>
            {relatedLinks && relatedLinks.length > 0 && (
              <div className="border-t pt-2">
                <p className="mb-1 text-xs uppercase text-muted-foreground">Related</p>
                {relatedLinks.map((r) => (
                  <div key={r.label} className="flex justify-between"><span>{r.label}</span><span className="font-medium">{r.count}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
