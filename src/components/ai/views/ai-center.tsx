'use client'

import * as React from 'react'
import { Sparkles, Send, AlertTriangle, Lightbulb, Mail, Trash2, RefreshCw, Lock, Radar } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { usePermissions } from '@/lib/auth/client-permissions'
import { ChatMarkdown } from '@/components/ai/chat-markdown'

const AI_TABS = ['suggestions', 'query', 'writer', 'anomalies'] as const
const AI_TAB_KEY = 'unstop:ai-center-tab'

export function AICenterView() {
  // Persist the active tab so control state survives mobile reloads.
  const [tab, setTab] = React.useState('suggestions')
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(AI_TAB_KEY)
      if (saved && (AI_TABS as readonly string[]).includes(saved)) setTab(saved)
    } catch { /* storage unavailable — default tab */ }
  }, [])
  const changeTab = (v: string) => {
    setTab(v)
    try { localStorage.setItem(AI_TAB_KEY, v) } catch { /* storage unavailable */ }
  }
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold tracking-tight">AI Center</h1><p className="text-muted-foreground">Smart suggestions, a broad Ask AI assistant, AI writer, anomaly detection</p></div>
      <Tabs value={tab} onValueChange={changeTab}>
        <div className="w-full overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="w-full justify-start sm:w-auto sm:justify-center">
            <TabsTrigger value="suggestions" className="shrink-0 px-3 min-h-9"><Lightbulb className="mr-1.5 size-3.5" /> Suggestions</TabsTrigger>
            <TabsTrigger value="query" className="shrink-0 px-3 min-h-9"><Sparkles className="mr-1.5 size-3.5" /> Ask AI</TabsTrigger>
            <TabsTrigger value="writer" className="shrink-0 px-3 min-h-9"><Mail className="mr-1.5 size-3.5" /> AI Writer</TabsTrigger>
            <TabsTrigger value="anomalies" className="shrink-0 px-3 min-h-9"><AlertTriangle className="mr-1.5 size-3.5" /> Anomalies</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="suggestions" className="mt-4"><SuggestionsTab /></TabsContent>
        <TabsContent value="query" className="mt-4"><QueryTab /></TabsContent>
        <TabsContent value="writer" className="mt-4"><WriterTab /></TabsContent>
        <TabsContent value="anomalies" className="mt-4"><AnomaliesTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function SuggestionsTab() {
  const [suggestions, setSuggestions] = React.useState<any[] | null>(null)
  const load = React.useCallback(async () => { const res = await fetch('/api/ai/suggestions', { cache: 'no-store' }); const d = await res.json(); setSuggestions(d.suggestions ?? []) }, [])
  React.useEffect(() => { load() }, [load])
  const generate = async () => {
    // The generate response carries the freshly created rows WITH detail/steps
    // (not persisted) — use it directly; fall back to a GET reload otherwise.
    try {
      const res = await fetch('/api/ai/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate' }) })
      const d = await res.json()
      if (Array.isArray(d.suggestions)) setSuggestions(d.suggestions)
      else load()
      toast.success('Suggestions generated')
    } catch { toast.error('Could not generate suggestions') }
  }
  const dismiss = async (id: string) => { await fetch('/api/ai/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss', id }) }); load() }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div><CardTitle className="text-base">Smart Suggestions</CardTitle><CardDescription>AI-powered next best actions</CardDescription></div>
        <Button size="sm" variant="outline" onClick={generate}><RefreshCw className="mr-1 size-4" /> Generate</Button>
      </CardHeader>
      <CardContent className="p-0">
        {!suggestions ? <Skeleton className="h-48 w-full" /> : suggestions.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">No suggestions. Click Generate to scan for opportunities.</div> :
          <ul className="divide-y">{suggestions.map(s => (
            <li key={s.id} className="flex items-start gap-3 p-3">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <div className="flex-1">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="text-xs text-muted-foreground">{s.description}</p>
                {s.detail && <p className="mt-1 text-xs italic text-muted-foreground">{s.detail}</p>}
                {Array.isArray(s.steps) && s.steps.length > 0 && (
                  <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {s.steps.map((step: string, i: number) => <li key={i}>{step}</li>)}
                  </ol>
                )}
              </div>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => dismiss(s.id)}><Trash2 className="size-3" /></Button>
            </li>
          ))}</ul>}
      </CardContent>
    </Card>
  )
}

// Broad, cross-domain starter prompts — Ask AI is a full assistant, not just
// CRM queries. Chips fire the question immediately.
const ASK_EXAMPLES = [
  'What is my win rate?',
  'Summarize my pipeline and suggest next best actions',
  'Draft a follow-up email to a hesitant lead',
  'What are the top CRM trends this week?',
  'Write a SQL query for monthly revenue',
  'Explain API rate limits like I am five',
]

function QueryTab() {
  const [question, setQuestion] = React.useState('')
  const [answer, setAnswer] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const ask = async (q?: string) => {
    const text = (q ?? question).trim()
    if (!text) return
    setLoading(true); setAnswer(null)
    if (q) setQuestion(q)
    try {
      let tz = 'UTC'
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { /* keep UTC */ }
      const res = await fetch('/api/ai/nlp-query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, timezone: tz }) })
      const data = await res.json()
      setAnswer(typeof data.summary === 'string' && data.summary ? data.summary : 'No answer came back. Please try again.')
    } catch { toast.error('Query failed') }
    finally { setLoading(false) }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ask AI</CardTitle>
        <CardDescription>Ask anything — CRM analytics, research, strategy, drafts, code. You get a structured, actionable answer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask() }} placeholder="Ask anything — 'What is my win rate?', 'Compare CRM vendors', 'Draft a proposal intro'…" aria-label="Ask AI question" />
          <Button onClick={() => ask()} disabled={loading || !question.trim()} aria-label="Ask"><Send className="size-4" /></Button>
        </div>
        {loading && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkles className="size-3.5 animate-pulse" /> Zia is thinking — grounding in your CRM and the web. This can take a few seconds…</div>
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        )}
        {answer && !loading && (
          <div className="rounded-lg border bg-muted/30 p-3"><ChatMarkdown text={answer} /></div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {ASK_EXAMPLES.map(q => (
            <button key={q} onClick={() => ask(q)} disabled={loading} className="rounded-full border px-2.5 py-1 text-xs transition hover:bg-muted disabled:opacity-50">{q}</button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function WriterTab() {
  const [prompt, setPrompt] = React.useState('')
  const [style, setStyle] = React.useState('professional')
  const [tone, setTone] = React.useState('friendly')
  const [result, setResult] = React.useState('')
  const [subject, setSubject] = React.useState('')
  const [alternatives, setAlternatives] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(false)
  const { canUseAiTemplates } = usePermissions()
  const generate = async () => {
    if (!prompt.trim()) return
    setLoading(true); setResult(''); setSubject(''); setAlternatives([])
    try {
      const res = await fetch('/api/ai/writer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, style, tone }) })
      const data = await res.json()
      setResult(data.content)
      setSubject(typeof data.subject === 'string' ? data.subject : '')
      setAlternatives(Array.isArray(data.alternatives) ? data.alternatives : [])
    } catch { toast.error('Generation failed') }
    finally { setLoading(false) }
  }
  // AI Templates gate — Admin and Manager only. The rest of the AI center
  // (suggestions, Ask AI, anomalies) stays available to everyone.
  if (!canUseAiTemplates) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">AI Email Writer</CardTitle><CardDescription>Generate professional emails with AI</CardDescription></CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border border-dashed p-4">
            <Lock className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">AI Templates are available to Admin and Manager users only.</p>
          </div>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">AI Email Writer</CardTitle><CardDescription>Generate professional emails with AI</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} placeholder="e.g., 'Write a follow-up email to Acme Corp about our enterprise pricing plans'" />
        <div className="grid grid-cols-2 gap-2">
          <Select value={style} onValueChange={setStyle}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="professional">Professional</SelectItem><SelectItem value="casual">Casual</SelectItem><SelectItem value="persuasive">Persuasive</SelectItem></SelectContent></Select>
          <Select value={tone} onValueChange={setTone}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="friendly">Friendly</SelectItem><SelectItem value="formal">Formal</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent></Select>
        </div>
        <Button onClick={generate} disabled={loading || !prompt.trim()} className="w-full"><Sparkles className="mr-1.5 size-4" /> {loading ? 'Generating…' : 'Generate Email'}</Button>
        {(result || subject || alternatives.length > 0) && (
          <div className="space-y-2">
            <div className="space-y-1.5">
              <Label htmlFor="writer-subject">Subject</Label>
              <Input id="writer-subject" value={subject} maxLength={60} onChange={e => setSubject(e.target.value)} placeholder="Subject line (max 60 characters)" />
            </div>
            {alternatives.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Alternative subjects:</span>
                {alternatives.map(a => (
                  <button key={a} type="button" onClick={() => setSubject(a)} title={a} className="rounded-full border px-2.5 py-1 text-xs transition hover:bg-muted">
                    Use subject
                  </button>
                ))}
              </div>
            )}
            <div className="rounded-lg border bg-muted/30 p-3"><pre className="whitespace-pre-wrap text-sm">{result}</pre></div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AnomaliesTab() {
  const [anomalies, setAnomalies] = React.useState<any[] | null>(null)
  const [scanning, setScanning] = React.useState(false)
  const load = React.useCallback(async () => { const res = await fetch('/api/ai/anomalies', { cache: 'no-store' }); const d = await res.json(); setAnomalies(d.anomalies ?? []) }, [])
  // Rule-based scan (the only writer of Anomaly rows) — runs once on mount,
  // then the refreshed open list is rendered; Rescan re-runs it on demand.
  const scan = React.useCallback(async () => {
    setScanning(true)
    try {
      const res = await fetch('/api/ai/anomalies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scan' }) })
      const d = await res.json()
      if (Array.isArray(d.anomalies)) setAnomalies(d.anomalies)
      else load()
    } catch { toast.error('Scan failed') }
    finally { setScanning(false) }
  }, [load])
  const scannedOnceRef = React.useRef(false)
  React.useEffect(() => {
    if (scannedOnceRef.current) return
    scannedOnceRef.current = true
    scan()
  }, [scan])
  const acknowledge = async (id: string) => { await fetch('/api/ai/anomalies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'acknowledge', id }) }); toast.success('Acknowledged'); load() }
  const severityColors: Record<string, string> = { critical: 'border-destructive/40 text-destructive', high: 'border-amber-500/40 text-amber-600', medium: 'border-blue-500/40 text-blue-600', low: 'border-muted-foreground/30 text-muted-foreground' }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div><CardTitle className="text-base">Anomaly Detection</CardTitle><CardDescription>AI-detected unusual patterns</CardDescription></div>
        <Button size="sm" variant="outline" onClick={scan} disabled={scanning}><Radar className={`mr-1 size-4 ${scanning ? 'animate-pulse' : ''}`} /> {scanning ? 'Scanning…' : 'Rescan'}</Button>
      </CardHeader>
      <CardContent className="p-0">
        {!anomalies ? <Skeleton className="h-32 w-full" /> : anomalies.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">No anomalies detected. All clear! ✅</div> :
          <ul className="divide-y">{anomalies.map(a => (
            <li key={a.id} className="flex items-start gap-3 p-3">
              <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${a.severity === 'critical' ? 'text-destructive' : a.severity === 'high' ? 'text-amber-500' : 'text-muted-foreground'}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2"><p className="text-sm font-medium">{a.anomalyType.replace(/_/g, ' ')}</p><Badge variant="outline" className={`text-[10px] capitalize ${severityColors[a.severity] ?? ''}`}>{a.severity}</Badge></div>
                <p className="text-xs text-muted-foreground">{a.description}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => acknowledge(a.id)}>Acknowledge</Button>
            </li>
          ))}</ul>}
      </CardContent>
    </Card>
  )
}
