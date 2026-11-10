'use client'

import * as React from 'react'
import { Play, Plus, Trash2, Save, Code2, Terminal, CheckCircle2, XCircle, Clock, Copy, Loader2, FileDown } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { downloadBlob } from '@/components/download-toast'

interface CustomFunction {
  id: string; name: string; description: string | null; language: string
  triggerEvent: string; code: string; isApproved: boolean; isActive: boolean
  executionCount: number; errorCount: number; lastExecutedAt: string | null
  _count?: { executions: number }
}

const TEMPLATES_LIST = [
  'Lead Score Calculator', 'Sync Deal to External System', 'Generate Invoice PDF',
  'Send WhatsApp on Stage Change', 'Auto-merge Duplicate Contacts',
]

interface TestResult {
  status: string
  output: unknown
  logs: string
  error: string | null
  executionTimeMs: number
}

interface PdfPayload {
  filename: string
  base64: string
  sizeBytes: number
}

const BASE64_PDF_PLACEHOLDER = '<base64 PDF — use Download button>'

/** Detect `{ pdf: { filename, base64, sizeBytes } }` (or top-level `__pdf`) in a function's output. */
function extractPdfPayload(output: unknown): PdfPayload | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const obj = output as Record<string, unknown>
  for (const key of ['pdf', '__pdf'] as const) {
    const c = obj[key]
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue
    const p = c as Record<string, unknown>
    if (typeof p.filename === 'string' && typeof p.base64 === 'string' && p.base64.length > 0) {
      const size = Number(p.sizeBytes)
      return {
        filename: p.filename,
        base64: p.base64,
        sizeBytes: Number.isFinite(size) && size > 0 ? size : p.base64.length,
      }
    }
  }
  return null
}

/** Copy of the output with the PDF base64 collapsed so the JSON view stays readable. */
function collapsePdfBase64(output: unknown): unknown {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output
  const clone: Record<string, unknown> = { ...(output as Record<string, unknown>) }
  for (const key of ['pdf', '__pdf'] as const) {
    const v = clone[key]
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>).base64 === 'string') {
      clone[key] = { ...(v as Record<string, unknown>), base64: BASE64_PDF_PLACEHOLDER }
    }
  }
  return clone
}

const API_HINT =
  'Sandbox API — crm.leads/deals/contacts.get(id), .update(id, fields), .query(filter), crm.users.get(id) · ' +
  'http.get/post(url[, body, headers]) → { status, body }; the hostname must be in the HTTP allowlist (Functions settings) or the call throws · ' +
  'kv.get(key) / kv.set(key, value) · log.info/error(...) · send_email(to, subject, body) & send_sms(to, body) → simulated only, nothing is really sent · ' +
  'await pdf.invoice({ number?, date?, dueDate?, from?, to?, items: [{ description, qty, price }], taxPercent?, currency? }) and ' +
  'await pdf.document({ title, lines: [{ text, size?, bold? }] }) → { filename, base64, sizeBytes } — a Download PDF button appears in the Test output.'

export function FunctionEditorView() {
  const [functions, setFunctions] = React.useState<CustomFunction[] | null>(null)
  const [selected, setSelected] = React.useState<CustomFunction | null>(null)
  const [code, setCode] = React.useState('')
  const [newOpen, setNewOpen] = React.useState(false)
  const [newFn, setNewFn] = React.useState({ name: '', language: 'javascript', triggerEvent: 'manual' })
  const [testInput, setTestInput] = React.useState('{\n  "record_id": "test-id"\n}')
  const [testResult, setTestResult] = React.useState<TestResult | null>(null)
  const [executing, setExecuting] = React.useState(false)
  const [executeError, setExecuteError] = React.useState<string | null>(null)
  const [preparingPdf, setPreparingPdf] = React.useState(false)
  const [history, setHistory] = React.useState<any[] | null>(null)

  const pdfPayload = React.useMemo(() => extractPdfPayload(testResult?.output), [testResult])
  const displayOutput = React.useMemo(() => collapsePdfBase64(testResult?.output), [testResult])

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/custom-functions', { cache: 'no-store' })
      const data = await res.json()
      setFunctions(data.functions ?? [])
      if (data.functions?.[0] && !selected) loadDetail(data.functions[0].id)
    } catch { setFunctions([]) }
  }, [selected])

  const loadDetail = async (id: string, opts?: { keepResult?: boolean }) => {
    const res = await fetch(`/api/custom-functions/${id}`, { cache: 'no-store' })
    const data = await res.json()
    setSelected(data.function)
    setCode(data.function.code || '')
    // Keep the test output when refreshing after an execution; only clear it
    // when the user actually switches to a different function.
    if (!opts?.keepResult) setTestResult(null)
    // Load history
    const histRes = await fetch(`/api/custom-functions/${id}/history`, { cache: 'no-store' })
    const histData = await histRes.json()
    setHistory(histData.executions ?? [])
  }

  React.useEffect(() => { load() }, [load])

  const create = async () => {
    try {
      const res = await fetch('/api/custom-functions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFn),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Function created')
      setNewOpen(false); setNewFn({ name: '', language: 'javascript', triggerEvent: 'manual' })
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  const save = async () => {
    if (!selected) return
    await fetch(`/api/custom-functions/${selected.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    toast.success('Saved (version snapshot created)')
    loadDetail(selected.id)
  }

  const execute = async () => {
    if (!selected) return
    setExecuting(true)
    setTestResult(null)
    setExecuteError(null)
    try {
      const inputData = JSON.parse(testInput || '{}')
      const res = await fetch(`/api/custom-functions/${selected.id}/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputData }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      setTestResult(data)
      if (data.status === 'completed') toast.success('Execution completed')
      else toast.error('Execution failed', { description: data.error || 'Check the output panel for details' })
      loadDetail(selected.id, { keepResult: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to execute function'
      setExecuteError(msg)
      toast.error('Test execution failed', { description: msg })
    } finally {
      setExecuting(false)
    }
  }

  const downloadPdf = async () => {
    if (!pdfPayload) return
    setPreparingPdf(true)
    try {
      const bin = atob(pdfPayload.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'application/pdf' })
      downloadBlob(blob, pdfPayload.filename, { label: 'PDF ready — from function output' })
      toast.success(`Downloading ${pdfPayload.filename}`)
    } catch (e) {
      toast.error('PDF download failed', { description: e instanceof Error ? e.message : 'The PDF payload could not be decoded' })
    } finally {
      setPreparingPdf(false)
    }
  }

  const loadTemplate = async (name: string) => {
    const res = await fetch('/api/custom-functions/templates', { cache: 'no-store' })
    const data = await res.json()
    const tmpl = (data.templates as any[]).find((t) => t.name === name)
    if (tmpl) {
      const createRes = await fetch('/api/custom-functions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tmpl.name, description: tmpl.description, language: tmpl.language, code: tmpl.code }),
      })
      if (createRes.ok) {
        toast.success(`Template "${name}" loaded`)
        load()
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Custom Functions</h1>
          <p className="text-muted-foreground">Write custom logic with sandboxed CRM API</p>
        </div>
        <Button onClick={() => setNewOpen(true)}><Plus className="mr-1.5 size-4" /> New function</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Function list */}
        <div className="space-y-2">
          {!functions ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />) :
           functions.map((fn) => (
            <button key={fn.id} onClick={() => loadDetail(fn.id)}
              className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/30 ${selected?.id === fn.id ? 'border-primary bg-muted/30' : ''}`}>
              <div className="flex items-center gap-2">
                <Code2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate font-medium">{fn.name}</span>
                {fn.isApproved && <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 text-[10px]">approved</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {fn.language} · {fn.executionCount} runs
                {fn.errorCount > 0 && <span className="text-destructive"> · {fn.errorCount} errors</span>}
              </p>
            </button>
          ))}
        </div>

        {/* Editor + test panel */}
        {selected ? (
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{selected.name}</CardTitle>
                  <CardDescription>{selected.description || 'No description'} · {selected.language}</CardDescription>
                </div>
                <Button size="sm" onClick={save}><Save className="mr-1 size-4" /> Save</Button>
              </CardHeader>
            </Card>

            <Tabs defaultValue="code">
              <TabsList>
                <TabsTrigger value="code"><Code2 className="mr-1.5 size-3.5" /> Code</TabsTrigger>
                <TabsTrigger value="test"><Terminal className="mr-1.5 size-3.5" /> Test</TabsTrigger>
                <TabsTrigger value="history"><Clock className="mr-1.5 size-3.5" /> History</TabsTrigger>
              </TabsList>

              {/* Code editor */}
              <TabsContent value="code">
                <Card>
                  <CardContent className="p-0">
                    <textarea
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="h-96 w-full resize-none rounded-lg border-0 bg-muted/30 p-4 font-mono text-sm focus:outline-none"
                      placeholder="// Write your custom function code here&#10;// Available: crm.leads.get(id), crm.deals.update(id, fields), http.post(url, body), kv.get(key), log.info(msg), send_email(to, subject, body), await pdf.invoice({...})&#10;&#10;const lead = crm.leads.get(record_id);&#10;return { score: 100 };"
                      spellCheck={false}
                    />
                    <p className="border-t px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">{API_HINT}</p>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Test panel */}
              <TabsContent value="test">
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Input (JSON)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <textarea
                        value={testInput}
                        onChange={(e) => setTestInput(e.target.value)}
                        className="h-48 w-full resize-none rounded-lg border bg-muted/30 p-3 font-mono text-xs"
                        spellCheck={false}
                      />
                      <Button className="mt-2" size="sm" onClick={execute} disabled={executing}>
                        {executing ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Play className="mr-1 size-4" />}
                        {executing ? 'Executing…' : 'Execute'}
                      </Button>
                      {executeError && (
                        <div role="alert" className="mt-2 break-words rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                          {executeError}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        Output
                        {testResult && (
                          <Badge variant="outline" className={testResult.status === 'completed' ? 'border-emerald-500/40 text-emerald-600' : 'border-destructive/40 text-destructive'}>
                            {testResult.status === 'completed' ? <CheckCircle2 className="mr-1 size-3" /> : <XCircle className="mr-1 size-3" />}
                            {testResult.status} · {testResult.executionTimeMs}ms
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {testResult ? (
                        <>
                          {testResult.status === 'failed' && (
                            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                              <div className="flex items-start gap-2">
                                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-semibold text-destructive">Execution failed</p>
                                  <p className="mt-0.5 break-words text-xs text-destructive/90">{testResult.error || 'Unknown error'}</p>
                                </div>
                              </div>
                              {testResult.logs && (
                                <pre className="mt-2 max-h-20 overflow-auto rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                                  {testResult.logs.split('\n').slice(-3).join('\n')}
                                </pre>
                              )}
                            </div>
                          )}
                          {pdfPayload && (
                            <div className="flex flex-col gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex min-w-0 items-center gap-2">
                                <FileDown className="size-4 shrink-0 text-emerald-600" />
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-medium">{pdfPayload.filename}</p>
                                  <p className="text-[10px] text-muted-foreground">{(pdfPayload.sizeBytes / 1024).toFixed(1)} KB · generated by this run</p>
                                </div>
                              </div>
                              <Button size="sm" onClick={downloadPdf} disabled={preparingPdf} className="shrink-0">
                                {preparingPdf ? <Loader2 className="mr-1 size-4 animate-spin" /> : <FileDown className="mr-1 size-4" />}
                                {preparingPdf ? 'Preparing…' : 'Download PDF'}
                              </Button>
                            </div>
                          )}
                          {displayOutput !== null && displayOutput !== undefined && (
                            <div>
                              <p className="mb-1 text-xs font-medium text-muted-foreground">Output</p>
                              <pre className="max-h-32 overflow-auto rounded-md bg-muted/50 p-2 text-xs">{JSON.stringify(displayOutput, null, 2)}</pre>
                            </div>
                          )}
                          {testResult.logs && (
                            <div>
                              <p className="mb-1 text-xs font-medium text-muted-foreground">Console</p>
                              <pre className="max-h-32 overflow-auto rounded-md bg-muted/50 p-2 text-xs">{testResult.logs}</pre>
                            </div>
                          )}
                        </>
                      ) : executing ? (
                        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" /> Executing…
                        </div>
                      ) : (
                        <p className="py-8 text-center text-sm text-muted-foreground">Run a test to see live output</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* History */}
              <TabsContent value="history">
                <Card>
                  <CardContent className="p-0">
                    {!history ? <Skeleton className="h-48 w-full" /> :
                     history.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No executions yet</div> :
                     <ul className="divide-y max-h-96 overflow-y-auto">
                       {history.map((e) => (
                         <li key={e.id} className="flex items-center gap-3 p-3">
                           <div className={`flex size-8 items-center justify-center rounded-full ${e.status === 'completed' ? 'bg-emerald-500/10' : e.status === 'failed' ? 'bg-destructive/10' : 'bg-amber-500/10'}`}>
                             {e.status === 'completed' ? <CheckCircle2 className="size-4 text-emerald-500" /> :
                              e.status === 'failed' ? <XCircle className="size-4 text-destructive" /> : <Clock className="size-4 text-amber-500" />}
                           </div>
                           <div className="min-w-0 flex-1">
                             <div className="flex items-center gap-2">
                               <Badge variant="outline" className="text-[10px] capitalize">{e.trigger}</Badge>
                               <span className="text-xs text-muted-foreground">{new Date(e.startedAt).toLocaleString()}</span>
                               <span className="text-xs text-muted-foreground">· {e.executionTimeMs}ms</span>
                             </div>
                             {e.errorMessage && <p className="text-xs text-destructive">{e.errorMessage}</p>}
                           </div>
                         </li>
                       ))}
                     </ul>}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">Select a function to edit</CardContent></Card>
        )}
      </div>

      {/* Templates */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Templates</CardTitle><CardDescription>Pre-built functions to get started</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {TEMPLATES_LIST.map((t) => (
            <Button key={t} variant="outline" size="sm" onClick={() => loadTemplate(t)}>
              <Copy className="mr-1.5 size-3.5" /> {t}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* New function dialog */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setNewOpen(false)}>
          <div className="w-full max-w-md rounded-lg border bg-background p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold">New custom function</h3>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={newFn.name} onChange={(e) => setNewFn({ ...newFn, name: e.target.value })} placeholder="Lead Score Calculator" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Language</Label><Select value={newFn.language} onValueChange={(v) => setNewFn({ ...newFn, language: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="javascript">JavaScript</SelectItem><SelectItem value="python">Python</SelectItem></SelectContent></Select></div>
                <div><Label>Trigger</Label><Select value={newFn.triggerEvent} onValueChange={(v) => setNewFn({ ...newFn, triggerEvent: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="webhook">Webhook</SelectItem><SelectItem value="workflow">Workflow</SelectItem><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="api">API</SelectItem></SelectContent></Select></div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button><Button onClick={create} disabled={!newFn.name}>Create</Button></div>
          </div>
        </div>
      )}
    </div>
  )
}
