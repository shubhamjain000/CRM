'use client'

import * as React from 'react'
import { Loader2, Mail, Send, Sparkles, RefreshCw, X, Check } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { RichTextEditor } from '@/components/content/editor/rich-text-editor'
import { toast } from 'sonner'

interface EmailTemplate {
  id: string
  name: string
  subject: string
  bodyHtml: string
  category?: string
}

/** A connected mailbox offered in the "From" selector (credentials stripped server-side). */
interface Mailbox {
  id: string
  emailAddress: string
  provider: string
  isActive: boolean
}

/** Sentinel for "no connected mailbox selected" in the Radix Select. */
const WORKSPACE_MAILBOX = 'workspace'

const LOOSE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** AI email draft categories (task 53-d) — keys map to /api/ai/email-template. */
const AI_CATEGORIES = [
  { key: 'follow_up', label: 'Follow Up' },
  { key: 'introduction', label: 'Introduction' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'reminder', label: 'Reminder' },
] as const

type AiCategoryKey = (typeof AI_CATEGORIES)[number]['key']

/** Modules the email-template API can load real record context for. */
const AI_MODULES = ['lead', 'contact', 'deal', 'account']

/** Comma-separated input → { valid addresses, invalid tokens }; empties ignored. */
function parseAddressList(raw: string): { addresses: string[]; invalid: string[] } {
  const addresses: string[] = []
  const invalid: string[] = []
  for (const part of raw.split(',')) {
    const v = part.trim()
    if (!v) continue
    if (LOOSE_EMAIL_RE.test(v)) addresses.push(v)
    else invalid.push(v)
  }
  return { addresses, invalid }
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  to: string
  relatedModule: string
  relatedId: string
  recordName: string
  /** Record context used to fill template merge fields ({{first_name}}, {{company}}, {{owner_name}}, …). */
  company?: string
  ownerName?: string
  /** Optional record phone — fills {{phone}}; when absent the tag is removed. */
  phone?: string
  /** Optional owner email — fills {{owner_email}}; when absent it becomes empty. */
  ownerEmail?: string
  onSent?: () => void
}

/** Plain text → minimal safe HTML paragraphs for the email body. */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>`)
    .join('')
}

/** Record values available for {{…}} merge-field substitution at send time. */
interface MergeContext {
  firstName: string
  lastName: string
  fullName: string
  email: string
  phone: string
  company: string
  ownerName: string
  ownerEmail: string
  date: string
}

/**
 * Fill the supported {{…}} merge fields (mirrors TEMPLATE_VARIABLES in
 * src/lib/templates/defaults.ts). Unknown tags are left untouched; a missing
 * value degrades gracefully — {{phone}} with no phone on the record is removed,
 * {{owner_email}} becomes empty.
 */
function applyMergeFields(text: string, ctx: MergeContext): string {
  return text
    .replace(/\{\{\s*first_name\s*\}\}/gi, ctx.firstName)
    .replace(/\{\{\s*last_name\s*\}\}/gi, ctx.lastName)
    .replace(/\{\{\s*full_name\s*\}\}/gi, ctx.fullName)
    .replace(/\{\{\s*email\s*\}\}/gi, ctx.email)
    .replace(/\{\{\s*phone\s*\}\}/gi, ctx.phone)
    .replace(/\{\{\s*company\s*\}\}/gi, ctx.company)
    .replace(/\{\{\s*owner_name\s*\}\}/gi, ctx.ownerName)
    .replace(/\{\{\s*owner_email\s*\}\}/gi, ctx.ownerEmail)
    .replace(/\{\{\s*date\s*\}\}/gi, ctx.date)
}

/**
 * Compose an email to a record from inside the CRM — template picker, optional
 * connected-Gmail "From" mailbox, CC/BCC, rich-text body, send via the mail API
 * (auto-linked to the record and logged on its timeline).
 */
export function ComposeEmailDialog({ open, onOpenChange, to, relatedModule, relatedId, recordName, company, ownerName, phone, ownerEmail, onSent }: Props) {
  const [templates, setTemplates] = React.useState<EmailTemplate[] | null>(null)
  const [templateId, setTemplateId] = React.useState('blank')
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [sending, setSending] = React.useState(false)
  // Additive: connected mailboxes ("From"), CC/BCC.
  const [mailboxes, setMailboxes] = React.useState<Mailbox[]>([])
  const [accountId, setAccountId] = React.useState(WORKSPACE_MAILBOX)
  const [cc, setCc] = React.useState('')
  const [bcc, setBcc] = React.useState('')
  // Additive (53-d): inline "Write with AI" panel above the body editor.
  const [aiOpen, setAiOpen] = React.useState(false)
  const [aiCategory, setAiCategory] = React.useState<AiCategoryKey>('follow_up')
  const [aiInstruction, setAiInstruction] = React.useState('')
  const [aiGenerating, setAiGenerating] = React.useState(false)
  const [aiSubject, setAiSubject] = React.useState('')
  const [aiBody, setAiBody] = React.useState('')
  const [aiError, setAiError] = React.useState('')
  const [aiVarsNote, setAiVarsNote] = React.useState('')

  const mergeCtx = React.useMemo<MergeContext>(() => {
    // first/last name come from the record name; when it is empty, fall back to
    // the "to" address local part ("priya.sharma@acme.com" → "priya sharma").
    const nameParts = recordName.trim().split(/\s+/).filter(Boolean)
    const local = to.includes('@') ? to.split('@')[0].replace(/[._\-+]+/g, ' ').trim() : ''
    const localParts = local.split(/\s+/).filter(Boolean)
    const firstName = nameParts[0] ?? localParts[0] ?? 'there'
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : (nameParts.length === 0 ? localParts.slice(1).join(' ') : '')
    return {
      firstName,
      lastName,
      fullName: recordName.trim() || firstName,
      email: to.trim(),
      // No phone on the record → the {{phone}} tag is removed gracefully.
      phone: phone?.trim() ?? '',
      company: company?.trim() || 'your team',
      ownerName: ownerName?.trim() || 'The Unstop team',
      // No owner email available → empty string.
      ownerEmail: ownerEmail?.trim() ?? '',
      date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    }
  }, [recordName, to, phone, company, ownerName, ownerEmail])

  React.useEffect(() => {
    if (!open) return
    setSubject(`Following up — ${recordName}`)
    setBody('')
    setCc('')
    setBcc('')
    setTemplateId('blank')
    // Reset the AI panel for a fresh compose session.
    setAiOpen(false)
    setAiCategory('follow_up')
    setAiInstruction('')
    setAiSubject('')
    setAiBody('')
    setAiError('')
    setAiVarsNote('')
    let cancelled = false
    fetch('/api/templates/email', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => { if (!cancelled) setTemplates(d.templates ?? []) })
      .catch(() => { if (!cancelled) setTemplates([]) })
    // Load the user's connected mailboxes for the optional "From" selector.
    // On failure or with no mailboxes the dialog behaves exactly as before
    // (sends via the workspace mailbox path).
    fetch('/api/email/accounts', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((d) => {
        if (cancelled) return
        const list: Mailbox[] = (Array.isArray(d?.accounts) ? d.accounts : []).filter((a: Mailbox) => a?.isActive !== false)
        setMailboxes(list)
        const gmail = list.find((m) => m.provider === 'gmail')
        setAccountId(gmail ? gmail.id : WORKSPACE_MAILBOX)
      })
      .catch(() => { if (!cancelled) setMailboxes([]) })
    return () => { cancelled = true }
  }, [open, recordName])

  const applyTemplate = (id: string) => {
    setTemplateId(id)
    const t = templates?.find((x) => x.id === id)
    if (t) {
      setSubject(applyMergeFields(t.subject || subject, mergeCtx))
      // Body is rich text (HTML) now — templates carry HTML natively.
      setBody(applyMergeFields(t.bodyHtml ?? '', mergeCtx))
    }
  }

  const hasAiDraft = Boolean(aiSubject.trim() || aiBody.trim())

  /** Call the contextual email-template API and load the preview. */
  const generateAi = async () => {
    if (aiGenerating) return
    setAiGenerating(true)
    setAiError('')
    try {
      const hasRecord = Boolean(relatedId && AI_MODULES.includes(relatedModule))
      const res = await fetch('/api/ai/email-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: aiCategory,
          ...(AI_MODULES.includes(relatedModule) ? { module: relatedModule } : {}),
          ...(hasRecord ? { recordId: relatedId } : {}),
          // No linked record → still generate, seeded with whatever we know.
          ...(!hasRecord ? { context: {
            ...(recordName.trim() ? { name: recordName.trim() } : {}),
            ...(company?.trim() ? { company: company.trim() } : {}),
            ...(ownerName?.trim() ? { ownerName: ownerName.trim() } : {}),
          } } : {}),
          ...(aiInstruction.trim() ? { instruction: aiInstruction.trim() } : {}),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error((typeof json?.error === 'string' && json.error) || `Generation failed (${res.status})`)
      const genSubject = typeof json?.subject === 'string' ? json.subject : ''
      const genBody = typeof json?.body === 'string' ? json.body : ''
      setAiSubject(genSubject)
      setAiBody(genBody)
      // Flag merge tokens the server could not resolve so the user knows.
      const leftovers = Array.from(new Set(
        (`${genSubject}\n${genBody}`.match(/\{\{\s*[a-zA-Z_]+\s*\}\}/g) ?? []).map((t) => t.replace(/\s+/g, '')),
      ))
      setAiVarsNote(leftovers.length ? `${leftovers.join(', ')} unresolved — showing fallback` : '')
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : 'Could not generate the email. Please try again.'
      setAiError(msg)
      toast.error(msg)
    } finally {
      setAiGenerating(false)
    }
  }

  /** Insert the AI draft into the compose window (subject + HTML body) and close the panel. */
  const useAiTemplate = () => {
    if (!hasAiDraft) { toast.error('Generate a draft first'); return }
    if (aiSubject.trim()) setSubject(aiSubject.trim())
    // Plain-text body → the same minimal safe HTML the send flow expects
    // (\n\n → <p>, single \n → <br/>) — exactly how applyTemplate injects HTML.
    setBody(textToHtml(aiBody))
    setAiOpen(false)
    toast.success('AI draft added to your email')
  }

  const send = async () => {
    if (!to.trim()) { toast.error('This record has no email address'); return }
    if (!subject.trim()) { toast.error('Subject is required'); return }
    const ccList = parseAddressList(cc)
    if (ccList.invalid.length) { toast.error(`Invalid Cc address: ${ccList.invalid[0]}`); return }
    const bccList = parseAddressList(bcc)
    if (bccList.invalid.length) { toast.error(`Invalid Bcc address: ${bccList.invalid[0]}`); return }
    setSending(true)
    try {
      // Rich-text HTML body; textToHtml fallback keeps the send honest when the
      // editor returns something visually empty.
      const textContent = body.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim()
      const bodyHtml = textContent ? applyMergeFields(body, mergeCtx) : textToHtml('(no content)')
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: [to.trim()],
          ...(ccList.addresses.length ? { cc: ccList.addresses } : {}),
          ...(bccList.addresses.length ? { bcc: bccList.addresses } : {}),
          subject: applyMergeFields(subject.trim(), mergeCtx),
          bodyHtml,
          relatedModule,
          relatedId,
          // Send THROUGH the chosen connected mailbox when one is selected.
          ...(accountId !== WORKSPACE_MAILBOX ? { accountId } : {}),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Failed to send')
      toast.success(`Email sent to ${to.trim()} — linked to ${recordName}`)
      onOpenChange(false)
      onSent?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send email')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="size-4 text-primary" /> Email {recordName}</DialogTitle>
          <DialogDescription>
            Sent from the workspace mailbox and linked to this record&apos;s timeline.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="compose-to">To</Label>
            <Input id="compose-to" value={to} readOnly className="bg-muted/50 font-mono text-sm" />
          </div>
          {mailboxes.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="compose-from">From</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="compose-from" aria-label="From mailbox">
                  <SelectValue placeholder="Workspace mailbox" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WORKSPACE_MAILBOX}>Workspace mailbox</SelectItem>
                  {mailboxes.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.emailAddress}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="compose-cc">Cc</Label>
              <Input
                id="compose-cc"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="name@company.com"
                inputMode="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compose-bcc">Bcc</Label>
              <Input
                id="compose-bcc"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder="name@company.com"
                inputMode="email"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="compose-template">Template</Label>
              <Button
                type="button" variant="ghost" size="sm"
                className="h-8 gap-1.5 px-2 text-primary hover:text-primary"
                onClick={() => setAiOpen((v) => !v)}
                aria-expanded={aiOpen}
                aria-controls="compose-ai-panel"
              >
                <Sparkles className="size-3.5" /> Write with AI
              </Button>
            </div>
            <Select value={templateId} onValueChange={applyTemplate}>
              <SelectTrigger id="compose-template" aria-label="Email template">
                <SelectValue placeholder="Choose a template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">Blank — write from scratch</SelectItem>
                {(templates ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Separate multiple Cc/Bcc addresses with commas.</p>
          </div>
          {aiOpen && (
            <div id="compose-ai-panel" className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
                  Write with AI
                </p>
                <Button
                  variant="ghost" size="icon" className="size-8"
                  onClick={() => setAiOpen(false)}
                  title="Close AI panel" aria-label="Close AI panel"
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Email category">
                {AI_CATEGORIES.map((c) => (
                  <button
                    key={c.key} type="button"
                    onClick={() => setAiCategory(c.key)}
                    aria-pressed={aiCategory === c.key}
                    className={`min-h-11 rounded-full border px-3.5 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      aiCategory === c.key
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <Input
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                placeholder="Instructions (optional) — e.g. mention the 20% discount"
                aria-label="AI instructions (optional)"
                className="h-11 text-sm"
                maxLength={500}
              />
              {aiError && (
                <p className="text-xs text-destructive" role="alert">{aiError}</p>
              )}
              {!hasAiDraft ? (
                <Button
                  type="button" className="h-11 w-full"
                  onClick={generateAi} disabled={aiGenerating}
                >
                  {aiGenerating
                    ? <Loader2 className="mr-1.5 size-4 animate-spin" />
                    : <Sparkles className="mr-1.5 size-4" />}
                  {aiGenerating ? 'Generating…' : 'Generate'}
                </Button>
              ) : (
                <>
                  {aiVarsNote && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">{aiVarsNote}</p>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-subject">Subject preview</Label>
                    <Input
                      id="ai-subject"
                      value={aiSubject}
                      onChange={(e) => setAiSubject(e.target.value)}
                      className="h-11 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-body">Body preview</Label>
                    <Textarea
                      id="ai-body"
                      value={aiBody}
                      onChange={(e) => setAiBody(e.target.value)}
                      rows={6}
                      className="min-h-[110px] resize-y text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button" variant="outline"
                      className="h-11 flex-1"
                      onClick={generateAi} disabled={aiGenerating}
                    >
                      <RefreshCw className={`mr-1.5 size-4 ${aiGenerating ? 'animate-spin' : ''}`} />
                      Regenerate
                    </Button>
                    <Button
                      type="button" className="h-11 flex-1"
                      onClick={useAiTemplate} disabled={aiGenerating}
                    >
                      <Check className="mr-1.5 size-4" />
                      Use Template
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="compose-subject">Subject</Label>
            <Input
              id="compose-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <RichTextEditor
              content={body}
              onChange={setBody}
              placeholder={`Hi ${recordName}, …`}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending || !to.trim() || !subject.trim()}>
            {sending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Send className="mr-1.5 size-4" />}
            Send email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
