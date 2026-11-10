'use client'

import * as React from 'react'
import { Plus, Palette, Users, MapPin, FileText, Box, Pencil, RotateCcw, Trash2, Copy, Eye, EyeOff } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Textarea } from '@/components/ui/textarea'
import { RichTextEditor } from '@/components/content/editor/rich-text-editor'
import {
  MAX_TEMPLATE_BODY_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  MAX_TEMPLATE_SUBJECT_LENGTH,
  getTemplateDefault,
  hasTemplateDefault,
  sampleTemplateValues,
  substituteTemplateVariables,
  type TemplateKind,
  type TemplateVariable,
} from '@/lib/templates/defaults'
import { toast } from 'sonner'
// Real email rendering — sandboxed iframe preview (style blocks, tables and
// full-document HTML behave like in the recipient's mail client).
import { EmailHtmlFrame } from './email-html-frame'
// Enhanced module builder (5.1–5.5) lives in its own file; ModulesTab stays a
// drop-in for the shell below.
import { ModulesTab } from './module-builder'
// 'Geist' must stay first — it is the app's native default font; the theme
// applier treats it as "no override" so the untouched app keeps its brand.
const FONTS = ['Geist', 'Inter', 'Roboto', 'Poppins', 'Noto Sans', 'Open Sans', 'Lato']
const RADII = ['none', 'small', 'medium', 'large', 'full']
const DENSITIES = ['compact', 'comfortable', 'spacious']
const SIDEBAR_STYLES = ['light', 'dark', 'colored']

export function PlatformSettingsView({ initialTab = 'modules' }: { initialTab?: string }) {
  // Controlled tab state so deep links (e.g. the sidebar "Module Builder"
  // entry) can land directly on one tab; default keeps the old behavior.
  const [tab, setTab] = React.useState(initialTab)
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold tracking-tight">Platform Settings</h1><p className="text-muted-foreground">Customize your CRM — modules, layouts, profiles, territories, themes, templates</p></div>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="w-full overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="w-full justify-start sm:w-auto sm:justify-center">
            <TabsTrigger value="modules" className="shrink-0 px-3 min-h-9"><Box className="mr-1.5 size-3.5" /> Modules</TabsTrigger>
            <TabsTrigger value="theme" className="shrink-0 px-3 min-h-9"><Palette className="mr-1.5 size-3.5" /> Theme</TabsTrigger>
            <TabsTrigger value="profiles" className="shrink-0 px-3 min-h-9"><Users className="mr-1.5 size-3.5" /> Profiles</TabsTrigger>
            <TabsTrigger value="territories" className="shrink-0 px-3 min-h-9"><MapPin className="mr-1.5 size-3.5" /> Territories</TabsTrigger>
            <TabsTrigger value="templates" className="shrink-0 px-3 min-h-9"><FileText className="mr-1.5 size-3.5" /> Templates</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="modules" className="mt-4"><ModulesTab /></TabsContent>
        <TabsContent value="theme" className="mt-4"><ThemeTab /></TabsContent>
        <TabsContent value="profiles" className="mt-4"><ProfilesTab /></TabsContent>
        <TabsContent value="territories" className="mt-4"><TerritoriesTab /></TabsContent>
        <TabsContent value="templates" className="mt-4"><TemplatesTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function ThemeTab() {
  const [theme, setTheme] = React.useState<any>(null)
  const [templates, setTemplates] = React.useState<any[]>([])

  const load = React.useCallback(async () => {
    const res = await fetch('/api/canvas-theme', { cache: 'no-store' })
    const data = await res.json()
    setTheme(data.theme); setTemplates(data.templates ?? [])
  }, [])
  React.useEffect(() => { load() }, [load])

  const save = async (data: Record<string, string>) => {
    const res = await fetch('/api/canvas-theme', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (!res.ok) { toast.error('Theme update failed'); return }
    toast.success('Theme updated')
    // Live-apply everywhere: the applier re-fetches on this event, and the
    // localStorage write syncs any other open tabs (storage event).
    try { localStorage.setItem('unstop:canvas-theme', String(Date.now())) } catch {}
    window.dispatchEvent(new Event('unstop:canvas-theme'))
  }

  const applyTemplate = async (t: any) => {
    await save({ primaryColor: t.primaryColor, accentColor: t.accentColor, fontFamily: t.fontFamily, borderRadius: t.borderRadius, density: t.density })
    load()
  }

  if (!theme) return <Skeleton className="h-96 w-full" />
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-sm">Colors</CardTitle></CardHeader><CardContent className="space-y-3">
          <div className="flex items-center gap-3"><Label className="w-24">Primary</Label><input type="color" value={theme.primaryColor} onChange={e => { setTheme({ ...theme, primaryColor: e.target.value }); save({ primaryColor: e.target.value }) }} className="size-8 rounded" /></div>
          <div className="flex items-center gap-3"><Label className="w-24">Accent</Label><input type="color" value={theme.accentColor} onChange={e => { setTheme({ ...theme, accentColor: e.target.value }); save({ accentColor: e.target.value }) }} className="size-8 rounded" /></div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Typography & Layout</CardTitle></CardHeader><CardContent className="space-y-3">
          <div className="flex items-center gap-3"><Label className="w-24">Font</Label><Select value={theme.fontFamily} onValueChange={v => { setTheme({ ...theme, fontFamily: v }); save({ fontFamily: v }) }}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>{FONTS.map(f => <SelectItem key={f} value={f}>{f === 'Geist' ? 'Geist (Default)' : f}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-center gap-3"><Label className="w-24">Radius</Label><Select value={theme.borderRadius} onValueChange={v => { setTheme({ ...theme, borderRadius: v }); save({ borderRadius: v }) }}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>{RADII.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-center gap-3"><Label className="w-24">Density</Label><Select value={theme.density} onValueChange={v => { setTheme({ ...theme, density: v }); save({ density: v }) }}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>{DENSITIES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-center gap-3"><Label className="w-24">Sidebar</Label><Select value={theme.sidebarStyle} onValueChange={v => { setTheme({ ...theme, sidebarStyle: v }); save({ sidebarStyle: v }) }}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>{SIDEBAR_STYLES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle className="text-sm">Theme Templates</CardTitle><CardDescription>Pre-built themes — click to apply</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">
        {templates.map(t => (
          <button key={t.name} onClick={() => applyTemplate(t)} className="flex items-center gap-2 rounded-lg border p-3 transition hover:bg-muted/30">
            <div className="flex gap-1"><span className="size-4 rounded-full" style={{ backgroundColor: t.primaryColor }} /><span className="size-4 rounded-full" style={{ backgroundColor: t.accentColor }} /></div>
            <span className="text-sm font-medium">{t.name}</span>
          </button>
        ))}
      </CardContent></Card>
    </div>
  )
}

function ProfilesTab() {
  const [profiles, setProfiles] = React.useState<any[] | null>(null)
  const [name, setName] = React.useState('')
  const load = React.useCallback(async () => { const res = await fetch('/api/profiles', { cache: 'no-store' }); const data = await res.json(); setProfiles(data.profiles ?? []) }, [])
  React.useEffect(() => { load() }, [load])
  const create = async () => { if (!name) return; await fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); toast.success('Profile created'); setName(''); load() }
  return (
    <Card><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-sm">Profiles</CardTitle></CardHeader><CardContent className="space-y-3">
      <div className="flex gap-2"><Input placeholder="Profile name" value={name} onChange={e => setName(e.target.value)} className="h-8" /><Button size="sm" onClick={create}><Plus className="size-4" /></Button></div>
      {!profiles ? <Skeleton className="h-32 w-full" /> : profiles.map(p => (
        <div key={p.id} className="flex items-center gap-2 rounded border p-2"><Users className="size-4 text-muted-foreground" /><span className="flex-1 text-sm font-medium">{p.name}</span>{p.isStandard && <Badge variant="secondary" className="text-[10px]">standard</Badge>}<Badge variant="outline" className="text-[10px]">{p._count?.permissions ?? 0} perms</Badge></div>
      ))}
    </CardContent></Card>
  )
}

function TerritoriesTab() {
  const [territories, setTerritories] = React.useState<any[] | null>(null)
  const [name, setName] = React.useState('')
  const load = React.useCallback(async () => { const res = await fetch('/api/territories', { cache: 'no-store' }); const data = await res.json(); setTerritories(data.territories ?? []) }, [])
  React.useEffect(() => { load() }, [load])
  const create = async () => { if (!name) return; await fetch('/api/territories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); toast.success('Territory created'); setName(''); load() }
  return (
    <Card><CardHeader><CardTitle className="text-sm">Territories</CardTitle></CardHeader><CardContent className="space-y-3">
      <div className="flex gap-2"><Input placeholder="Territory name" value={name} onChange={e => setName(e.target.value)} className="h-8" /><Button size="sm" onClick={create}><Plus className="size-4" /></Button></div>
      {!territories ? <Skeleton className="h-32 w-full" /> : territories.map(t => (
        <div key={t.id} className="flex items-center gap-2 rounded border p-2"><MapPin className="size-4 text-muted-foreground" /><span className="flex-1 text-sm font-medium">{t.name}</span><Badge variant="outline" className="text-[10px]">{t._count?.members ?? 0} members</Badge></div>
      ))}
    </CardContent></Card>
  )
}

// ---------------------------------------------------------------------------
// Templates — list + create form (unchanged), plus a sheet editor with live
// preview, insert-variable toolbar, reset-to-default and delete. Seeded
// default content + merge-tag helpers live in src/lib/templates/defaults.ts,
// shared with the PATCH/DELETE route handlers in src/app/api/templates/**.
// ---------------------------------------------------------------------------

type TemplateRecord = { id: string; name: string; subject?: string; bodyHtml?: string; htmlTemplate?: string; category?: string }

// Variable chips grouped for the editor toolbar — labels over each flex group.
const VARIABLE_GROUPS: { label: string; vars: TemplateVariable[] }[] = [
  { label: 'Record', vars: ['first_name', 'last_name', 'full_name', 'email', 'phone', 'company'] },
  { label: 'Owner', vars: ['owner_name', 'owner_email'] },
  { label: 'Meta', vars: ['date'] },
]

/** "Insert variable" chips, grouped Record / Owner / Meta. */
function VariableButtons({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-wrap items-start gap-x-5 gap-y-1.5">
      {VARIABLE_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{group.label}</span>
          {group.vars.map((v) => (
            <Button key={v} type="button" variant="outline" size="sm" className="h-6 rounded-full px-2 font-mono text-[11px]" onClick={() => onInsert('{{' + v + '}}')}>
              {'{{' + v + '}}'}
            </Button>
          ))}
        </div>
      ))}
    </div>
  )
}

// Preview pane — mounts only while the Preview tab is active, so {{date}}
// always resolves to "today" and the sample set refreshes on every switch.
// Email bodies render inside a sandboxed iframe (EmailHtmlFrame) — a real
// mail-client rendering, not the app's prose styling.
function TemplatePreview({ kind, subject, body }: { kind: TemplateKind; subject: string; body: string }) {
  const values = sampleTemplateValues()
  const rendered = substituteTemplateVariables(body, values)
  return (
    <div className="space-y-3">
      {kind === 'email' && (
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">Subject</p>
          <p className="break-words text-sm font-medium">{substituteTemplateVariables(subject, values) || <span className="text-muted-foreground">(empty)</span>}</p>
        </div>
      )}
      {kind === 'email' ? (
        <EmailHtmlFrame html={rendered} />
      ) : (
        <div className="min-h-48 whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-4 font-mono text-xs">
          {rendered || <span className="text-muted-foreground">Empty body</span>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Preview with sample data — unknown variables are left as-is.</p>
    </div>
  )
}

function TemplateEditorSheet({ kind, template, open, onOpenChange, onSaved }: {
  kind: TemplateKind
  template: TemplateRecord
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const isEmail = kind === 'email'
  // Non-null only when the template name matches a seeded system template.
  const seeded = getTemplateDefault(kind, template.name)
  const [name, setName] = React.useState(template.name ?? '')
  const [subject, setSubject] = React.useState(template.subject ?? '')
  const [body, setBody] = React.useState((isEmail ? template.bodyHtml : template.htmlTemplate) ?? '')
  const [tab, setTab] = React.useState('edit')
  const [saving, setSaving] = React.useState(false)
  const [confirmReset, setConfirmReset] = React.useState(false)
  const pdfBodyRef = React.useRef<HTMLTextAreaElement | null>(null)

  // Email bodies are rich HTML — append the merge tag at the end of the
  // source; tiptap normalises and renders it immediately.
  const appendToken = (token: string) => setBody((b) => b + token)

  // PDF templates are plain HTML source in a textarea — insert at the cursor.
  const insertTokenAtCursor = (token: string) => {
    const el = pdfBodyRef.current
    if (!el) { appendToken(token); return }
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    setBody(el.value.slice(0, start) + token + el.value.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + token.length
    })
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) { toast.error('Name is required'); return }
    if (trimmed.length > MAX_TEMPLATE_NAME_LENGTH) { toast.error(`Name must be at most ${MAX_TEMPLATE_NAME_LENGTH} characters`); return }
    if (body.length > MAX_TEMPLATE_BODY_LENGTH) { toast.error(`Body must be at most ${MAX_TEMPLATE_BODY_LENGTH} characters`); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/templates/${kind}/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEmail ? { name: trimmed, subject, bodyHtml: body } : { name: trimmed, htmlTemplate: body }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { toast.error(data?.error ?? 'Failed to save template'); return }
      toast.success('Template saved')
      onSaved()
      onOpenChange(false)
    } catch {
      toast.error('Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  // Replaces the EDITOR content only — the user still has to press Save.
  const resetToDefault = () => {
    if (!seeded) return
    if (seeded.subject !== undefined) setSubject(seeded.subject)
    setBody(seeded.body)
    setTab('edit')
    setConfirmReset(false)
    toast.info('Editor restored to default — press Save to apply')
  }

  const resetButton = (
    <Button type="button" variant="ghost" size="sm" disabled={!seeded} className="text-muted-foreground" onClick={() => setConfirmReset(true)}>
      <RotateCcw className="size-3.5" /> Reset to Default
    </Button>
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl">
        <SheetHeader className="pr-8">
          <SheetTitle>Edit {isEmail ? 'email' : 'PDF'} template</SheetTitle>
          <SheetDescription>
            {isEmail ? 'Rich HTML email with merge tags — substituted when the email is sent.' : 'PDF template HTML source with merge tags.'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-2">
          <Tabs value={tab} onValueChange={setTab}>
            <div className="w-full overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList className="w-full justify-start sm:w-auto">
                <TabsTrigger value="edit" className="shrink-0 px-3 min-h-9">Edit</TabsTrigger>
                <TabsTrigger value="preview" className="shrink-0 px-3 min-h-9">Preview</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="edit" className="mt-3 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Name</Label>
                <Input id="tpl-name" value={name} maxLength={MAX_TEMPLATE_NAME_LENGTH} onChange={(e) => setName(e.target.value)} />
              </div>
              {isEmail && (
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-subject">Subject</Label>
                  <Input id="tpl-subject" value={subject} maxLength={MAX_TEMPLATE_SUBJECT_LENGTH} onChange={(e) => setSubject(e.target.value)} />
                </div>
              )}
              <VariableButtons onInsert={isEmail ? appendToken : insertTokenAtCursor} />
              {isEmail ? (
                <RichTextEditor content={body} onChange={setBody} placeholder="Write the email body — use the variable buttons to insert merge tags" />
              ) : (
                <Textarea ref={pdfBodyRef} rows={16} value={body} className="font-mono text-xs" placeholder="HTML template source…" onChange={(e) => setBody(e.target.value)} />
              )}
            </TabsContent>
            <TabsContent value="preview" className="mt-3">
              <TemplatePreview kind={kind} subject={subject} body={body} />
            </TabsContent>
          </Tabs>
        </div>
        <SheetFooter className="flex-row flex-wrap items-center justify-between gap-2">
          {seeded ? resetButton : (
            <Tooltip>
              <TooltipTrigger asChild><span>{resetButton}</span></TooltipTrigger>
              <TooltipContent>Custom template — no default</TooltipContent>
            </Tooltip>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </SheetFooter>
        <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset this template to its default content?</AlertDialogTitle>
              <AlertDialogDescription>
                The editor will be refilled with the original seeded subject and body. Nothing is saved until you press Save.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={resetToDefault}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}

function TemplatesTab() {
  const [emailTpls, setEmailTpls] = React.useState<TemplateRecord[] | null>(null)
  const [pdfTpls, setPdfTpls] = React.useState<TemplateRecord[] | null>(null)
  const [emailForm, setEmailForm] = React.useState({ name: '', subject: '', bodyHtml: '' })
  // Live preview is ON by default — the typed HTML renders immediately in a
  // sandboxed iframe (side-by-side on desktop, below on mobile) so the body
  // is always "viewed as real", not just as source. The button only hides it.
  const [showQuickPreview, setShowQuickPreview] = React.useState(true)
  // Debounced mirror of the typed HTML — keeps the live iframe from reloading
  // on every keystroke while still updating within a fraction of a second.
  const [quickPreviewBody, setQuickPreviewBody] = React.useState('')
  const [editor, setEditor] = React.useState<{ kind: TemplateKind; template: TemplateRecord } | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<{ kind: TemplateKind; template: TemplateRecord } | null>(null)
  const load = React.useCallback(async () => {
    const [e, p] = await Promise.all([fetch('/api/templates/email', { cache: 'no-store' }).then(r => r.json()), fetch('/api/templates/pdf', { cache: 'no-store' }).then(r => r.json())])
    setEmailTpls(e.templates ?? []); setPdfTpls(p.templates ?? [])
  }, [])
  React.useEffect(() => { load() }, [load])
  React.useEffect(() => {
    const t = setTimeout(() => setQuickPreviewBody(emailForm.bodyHtml), 350)
    return () => clearTimeout(t)
  }, [emailForm.bodyHtml])
  const quickPreviewReady = showQuickPreview && quickPreviewBody.trim().length > 0
  const createEmail = async () => {
    if (!emailForm.name.trim()) { toast.error('Name is required'); return }
    try {
      const res = await fetch('/api/templates/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(emailForm) })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || 'Failed to create template')
      toast.success('Email template created')
      setEmailForm({ name: '', subject: '', bodyHtml: '' })
      setShowQuickPreview(false)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create template')
    }
  }
  const removeTemplate = async () => {
    if (!deleteTarget) return
    const res = await fetch(`/api/templates/${deleteTarget.kind}/${deleteTarget.template.id}`, { method: 'DELETE' })
    if (!res.ok) { const data = await res.json().catch(() => null); toast.error(data?.error ?? 'Failed to delete template'); return }
    toast.success('Template deleted')
    setDeleteTarget(null)
    load()
  }
  const [duplicating, setDuplicating] = React.useState<string | null>(null)
  const duplicateTemplate = async (kind: TemplateKind, t: TemplateRecord) => {
    if (duplicating) return
    setDuplicating(t.id)
    try {
      // POST a copy: name + ' (copy)', subject/body/category (email) or
      // htmlTemplate/category (pdf) — the new row appears after reload.
      const payload = kind === 'email'
        ? { name: `${t.name} (copy)`, subject: t.subject ?? '', bodyHtml: t.bodyHtml ?? '', ...(t.category ? { category: t.category } : {}) }
        : { name: `${t.name} (copy)`, htmlTemplate: t.htmlTemplate ?? '', ...(t.category ? { category: t.category } : {}) }
      const res = await fetch(`/api/templates/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? 'Failed to duplicate template')
        return
      }
      toast.success(`Duplicated "${t.name}"`)
      load()
    } catch {
      toast.error('Failed to duplicate template')
    } finally {
      setDuplicating(null)
    }
  }
  const renderRow = (kind: TemplateKind, t: TemplateRecord) => (
    <div key={t.id} className="flex items-center gap-2 rounded border p-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{t.name}</span>
          {hasTemplateDefault(kind, t.name) && <Badge variant="secondary" className="shrink-0 text-[10px]">system</Badge>}
        </div>
        <div className="truncate text-xs text-muted-foreground">{kind === 'email' ? (t.subject || 'No subject') : (t.category || 'general')}</div>
      </div>
      <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={() => setEditor({ kind, template: t })}>
        <Pencil className="size-3.5" /> Edit Template
      </Button>
      <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`Duplicate ${t.name}`} title="Duplicate" disabled={duplicating === t.id} onClick={() => duplicateTemplate(kind, t)}>
        <Copy className={`size-3.5 ${duplicating === t.id ? 'animate-pulse' : ''}`} />
      </Button>
      <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Delete ${t.name}`} onClick={() => setDeleteTarget({ kind, template: t })}>
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
  return (
    <div className="space-y-4">
      <Card><CardHeader><CardTitle className="text-sm">Email Templates</CardTitle></CardHeader><CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2"><Input placeholder="Name" value={emailForm.name} onChange={e => setEmailForm({ ...emailForm, name: e.target.value })} /><Input placeholder="Subject" value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} /></div>
        <div className={showQuickPreview ? 'grid gap-2 lg:grid-cols-2' : 'grid gap-2'}>
          <Textarea placeholder="Body HTML — e.g. <p>Hi {{first_name}}, …</p>" rows={6} className="font-mono text-xs" value={emailForm.bodyHtml} onChange={e => setEmailForm({ ...emailForm, bodyHtml: e.target.value })} />
          {showQuickPreview && (
            <div className="flex min-h-24 flex-col gap-2 overflow-y-auto rounded-md border bg-muted/20 p-2 lg:max-h-72">
              {quickPreviewReady ? (
                <>
                  <div className="rounded-md border bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">Subject</p>
                    <p className="break-words text-sm font-medium">{substituteTemplateVariables(emailForm.subject, sampleTemplateValues()) || <span className="text-muted-foreground">(empty)</span>}</p>
                  </div>
                  <EmailHtmlFrame html={substituteTemplateVariables(quickPreviewBody, sampleTemplateValues())} />
                  <p className="text-xs text-muted-foreground">Live preview — renders like the recipient&apos;s mail client (sample data).</p>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center px-3 text-center">
                  <p className="text-xs text-muted-foreground">Live preview appears here as you type HTML — styles, tables and merge tags render like in the recipient&apos;s mail client.</p>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" onClick={createEmail}><Plus className="mr-1 size-4" /> Add email template</Button>
          <Button size="sm" variant="outline" disabled={!emailForm.bodyHtml.trim()} onClick={() => setShowQuickPreview(v => !v)}>
            {showQuickPreview ? <EyeOff className="mr-1 size-3.5" /> : <Eye className="mr-1 size-3.5" />}
            {showQuickPreview ? 'Hide preview' : 'Show preview'}
          </Button>
        </div>
        {!emailTpls ? <Skeleton className="h-20 w-full" /> : emailTpls.map(t => renderRow('email', t))}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm">PDF Templates</CardTitle></CardHeader><CardContent className="space-y-2">
        {!pdfTpls ? <Skeleton className="h-20 w-full" /> : pdfTpls.length === 0 ? <p className="text-sm text-muted-foreground">No PDF templates yet</p> : pdfTpls.map(t => renderRow('pdf', t))}
      </CardContent></Card>

      {editor && (
        <TemplateEditorSheet
          key={`${editor.kind}:${editor.template.id}`}
          kind={editor.kind}
          template={editor.template}
          open
          onOpenChange={(o) => { if (!o) setEditor(null) }}
          onSaved={load}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteTarget?.template.name}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={removeTemplate} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
