'use client'

import * as React from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import {
  UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowLeft, ArrowRight,
  Download, Loader2, X, FileText, UserCheck, Lock, Sparkles, Wand2,
} from 'lucide-react'
import { parseImportFile, ACCEPTED_IMPORT_TYPES, ACCEPTED_IMPORT_LABEL, type ParsedTable } from '@/lib/import-parsers'
import { usePermissions } from '@/lib/auth/client-permissions'

export type ImportModule = 'lead' | 'contact' | 'account' | 'deal'

interface FieldDef {
  key: string
  label: string
  required?: boolean
  hint?: string
  example: string
  /** Sales-agent-owned field — left blank on import, filled in the CRM later. */
  agent?: boolean
}

const MODULE_FIELDS: Record<ImportModule, FieldDef[]> = {
  lead: [
    { key: 'firstName', label: 'First name', required: true, example: 'Ada' },
    { key: 'lastName', label: 'Last name', required: true, example: 'Lovelace' },
    { key: 'company', label: 'Company', example: 'Analytical Engines Ltd' },
    { key: 'title', label: 'Job title', example: 'CTO' },
    { key: 'emails', label: 'Email(s) — separate with ;', hint: 'Duplicates are detected by the first email', example: 'ada@example.com' },
    { key: 'phones', label: 'Phone(s) — separate with ;', example: '+1 555 010 2030' },
    { key: 'leadStatus', label: 'Status', hint: 'new | contacted | qualified | unqualified | converted', example: 'new' },
    { key: 'rating', label: 'Rating', hint: 'hot | warm | cold', example: 'hot' },
    { key: 'leadSource', label: 'Lead source', example: 'Website' },
    { key: 'industry', label: 'Industry', example: 'Technology' },
    { key: 'website', label: 'Website', example: 'https://example.com' },
    { key: 'annualRevenue', label: 'Annual revenue', example: '500000' },
    { key: 'employees', label: 'Employees', example: '120' },
    { key: 'score', label: 'Score', example: '72' },
    { key: 'description', label: 'Description', example: 'Met at expo' },
  ],
  contact: [
    { key: 'firstName', label: 'First name', required: true, example: 'Ada' },
    { key: 'lastName', label: 'Last name', example: 'Lovelace' },
    { key: 'fullName', label: 'Full name', hint: 'Split on the first space when First/Last name are not mapped', example: 'Ada Lovelace' },
    { key: 'title', label: 'Job title', example: 'CTO' },
    { key: 'department', label: 'Department', example: 'Engineering' },
    { key: 'emails', label: 'Email(s) — separate with ;', hint: 'Same email + a NEW listing link adds a listing to the contact; only the exact same email+link is a duplicate', example: 'ada@example.com' },
    { key: 'phones', label: 'Phone(s) — separate with ;', example: '+1 555 010 2030' },
    { key: 'accountName', label: 'Account name', hint: 'Matched by company name — missing companies are created automatically so one company always stays one account', example: 'Acme Corp' },
    { key: 'leadSource', label: 'Lead source', example: 'Referral' },
    { key: 'description', label: 'Description', example: 'Key decision maker' },
    // Listing Intelligence (additive)
    { key: 'recruiterTag', label: 'Recruiter tag', hint: 'New Recruiter | Existing Recruiter', example: 'New Recruiter' },
    { key: 'premiumStatus', label: 'Premium', hint: 'Free | Paid (yes/paid → Paid, no/free → Free)', example: 'Paid' },
    { key: 'listingSubtype', label: 'Listing subtype', hint: 'Jobs | Internships', example: 'Jobs' },
    { key: 'listingUrl', label: 'Listing URL', hint: 'Each NEW link adds a listing to the contact\'s history', example: 'https://unstop.com/opportunities/…' },
    { key: 'listingTitle', label: 'Listing title', example: 'Software Engineer Intern' },
    { key: 'listingCategory', label: 'Listing category', hint: 'Accepts ["A" "B"] array text, or multiple split on | or ;', example: 'Fresher|Engineering Students' },
    { key: 'totalApplications', label: 'Total applications', example: '240' },
    { key: 'reasonableFitPct', label: 'Reasonable fit %', hint: '0–100, a trailing % is stripped', example: '72' },
    { key: 'reasonableScoreUsers', label: 'Reasonable score users', example: '18' },
    { key: 'dateApproved', label: 'Date approved', hint: 'YYYY-MM-DD, "November 2, 2026, 6:24 PM", or YYYY-MM-DD HH:mm:ss', example: '2025-01-15' },
    { key: 'visibility', label: 'Visibility', hint: 'Public | Private — left blank for the sales agent when the column is missing', example: 'Public' },
    { key: 'hiredCount', label: 'Hired count', hint: 'Hires closed through this listing — blank until the sales agent fills it', example: '3' },
    { key: 'hiringStatus', label: 'Hiring status', hint: 'Open | In Review | Filled | Closed — blank until the sales agent fills it', example: 'Open' },
    { key: 'relevantApplications', label: 'Relevant applications (34% match & above)', example: '86' },
    // Sales-agent-owned — intentionally left blank by the import; the sales
    // team fills these in the CRM after the row lands.
    { key: 'csmRecruiterType', label: 'CSM recruiter type', agent: true, hint: 'First Time | Existing | New', example: 'First Time' },
    { key: 'csmStatus', label: 'CSM status', agent: true, example: 'Onboarded' },
    { key: 'csmNextCallDate', label: 'CSM next call date', agent: true, hint: 'YYYY-MM-DD', example: '2025-02-01' },
    { key: 'totalReachoutsDone', label: 'Total reachouts done', agent: true, example: '4' },
    { key: 'lastReachedOutAt', label: 'Last reached-out at', agent: true, hint: 'YYYY-MM-DD or YYYY-MM-DD HH:mm:ss', example: '2025-01-20 14:30:00' },
  ],
  account: [
    { key: 'name', label: 'Account name', required: true, example: 'Acme Corp' },
    { key: 'accountNumber', label: 'Account number', example: 'ACC-1001' },
    { key: 'accountType', label: 'Account type', hint: 'customer | prospect | partner | competitor | vendor', example: 'prospect' },
    { key: 'industry', label: 'Industry', example: 'Manufacturing' },
    { key: 'website', label: 'Website', example: 'https://acme.com' },
    { key: 'annualRevenue', label: 'Annual revenue', example: '2000000' },
    { key: 'employees', label: 'Employees', example: '250' },
    { key: 'rating', label: 'Rating', example: 'A' },
    { key: 'ownership', label: 'Ownership', example: 'Public' },
  ],
  deal: [
    { key: 'name', label: 'Deal name', required: true, example: 'Acme — Annual licence' },
    { key: 'amount', label: 'Amount', example: '850000' },
    { key: 'currency', label: 'Currency', example: 'INR' },
    { key: 'closeDate', label: 'Close date', hint: 'YYYY-MM-DD', example: '2025-12-31' },
    { key: 'probability', label: 'Probability %', example: '60' },
    { key: 'type', label: 'Deal type', hint: 'new_business | existing_business | renewal', example: 'new_business' },
    { key: 'leadSource', label: 'Lead source', example: 'Inbound' },
    { key: 'accountName', label: 'Account name', hint: 'Matched to an existing account by exact name', example: 'Acme Corp' },
    { key: 'nextStep', label: 'Next step', example: 'Send contract' },
    { key: 'description', label: 'Description', example: 'Annual plan, 40 seats' },
  ],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Catch-all mapping target: columns that don't match any CRM field are NOT
 * skipped — their cells are folded into the record's Description as
 * "Header: value" lines, so every column of the file is picked up.
 */
const EXTRA_KEY = '__extras'
const EXTRA_LABEL = 'Extra info → Description'

/**
 * Rows per request — big files are split into sequential batches. A 3,785-row
 * daily export used to travel as ONE ~2MB JSON request whose server-side work
 * (dedupe prefetch + per-row updates + listing history) could run for many
 * minutes and die on size/timeout — batches keep every request small and give
 * the user live progress.
 */
const IMPORT_BATCH_SIZE = 400
/** Hard client-side ceiling now that batching makes large files practical. */
const MAX_IMPORT_FILE_ROWS = 50000

const AUTO_ALIASES: Record<string, string[]> = {
  firstname: ['firstname', 'fname', 'givenname', 'first'],
  lastname: ['lastname', 'lname', 'surname', 'last', 'familyname'],
  name: ['name', 'accountname', 'account', 'company', 'dealname', 'deal'],
  fullname: ['fullname', 'name', 'contactname', 'recruitername'],
  company: ['company', 'companyname', 'organisation', 'organization', 'organisationname', 'organizationname'],
  emails: ['email', 'emails', 'emailaddress', 'emailaddresses', 'mail', 'mailid', 'emailid', 'email1'],
  phones: ['phone', 'phones', 'phonenumber', 'phoneno', 'mobile', 'telephone', 'mobileno', 'mobilenumber', 'contactno', 'contactnumber', 'whatsapp'],
  title: ['title', 'jobtitle', 'designation', 'roletitle'],
  department: ['department', 'dept'],
  leadstatus: ['leadstatus', 'status'],
  rating: ['rating'],
  leadsource: ['leadsource', 'source'],
  industry: ['industry'],
  website: ['website', 'url', 'web', 'site'],
  annualrevenue: ['annualrevenue', 'revenue'],
  employees: ['employees', 'employeecount', 'staff'],
  score: ['score', 'leadscore'],
  description: ['description', 'notes', 'comments', 'note'],
  accountnumber: ['accountnumber'],
  accounttype: ['accounttype', 'type'],
  ownership: ['ownership'],
  amount: ['amount', 'dealamount', 'value'],
  currency: ['currency'],
  closedate: ['closedate', 'closingdate', 'expectedclosedate'],
  probability: ['probability'],
  type: ['type', 'dealtype'],
  nextstep: ['nextstep'],
  accountname: ['accountname', 'account', 'company', 'companyname'],
  // Listing Intelligence (contact)
  recruitertag: ['recruitertag', 'recruiter'],
  premiumstatus: ['premium', 'premiumstatus', 'paidstatus'],
  listingsubtype: ['subtype', 'listingsubtype', 'listingtype'],
  listingurl: ['listinglink', 'listingurl', 'link', 'joblink', 'opportunitylink'],
  listingtitle: ['listingtitle', 'postingtitle'],
  listingcategory: ['category', 'listingcategory', 'categories'],
  totalapplications: ['applications', 'totalapplications', 'applicationcount', 'noofapplications'],
  reasonablefitpct: ['reasonablefit', 'reasonablefitpct', 'fitpercent', 'fit'],
  reasonablescoreusers: ['reasonablescoreusers', 'reasonablescore'],
  dateapproved: ['dateapproved', 'approveddate', 'approvedon'],
  visibility: ['visibility', 'listingvisibility', 'visible'],
  hiredcount: ['hiredcount', 'hired', 'hires', 'numberhired', 'hirescount'],
  hiringstatus: ['hiringstatus', 'hirestatus', 'hiring'],
  relevantapplications: ['relevantapplications', 'relevantapplication', 'relevantapps', 'relevantapplicants', 'applications34', 'matchapplications'],
  csmrecruitertype: ['csmrecruitertype', 'recruitertype'],
  csmstatus: ['csmstatus'],
  csmnextcalldate: ['csmnextcalldate', 'nextcalldate'],
  totalreachoutsdone: ['totalreachoutsdone', 'reachoutsdone'],
  lastreachedoutat: ['lastreachedoutat', 'lastreachedout'],
}

/**
 * Pick a target for EVERY column — none is left on skip.
 *  1. Exact match: normalized header equals the field key, label or a known alias.
 *  2. Fuzzy containment: the header contains a known alias (longest alias wins,
 *     so "listingtitle" beats "title") or an alias contains the header.
 *  3. Everything still unmatched maps to the Description collector (EXTRA_KEY)
 *     so no data in the file is silently dropped.
 */
function autoMap(headers: string[], moduleName: ImportModule): (string | null)[] {
  const fields = MODULE_FIELDS[moduleName]
  // Flat alias table — one entry per (field, alias). Longest alias first so
  // specific targets always beat generic substrings; the sort is stable, so
  // ties keep the field definition order.
  const pairs: { alias: string; field: FieldDef }[] = []
  for (const f of fields) {
    const aliases = new Set<string>([norm(f.key), norm(f.label), ...(AUTO_ALIASES[norm(f.key)] ?? [])])
    for (const a of aliases) if (a) pairs.push({ alias: a, field: f })
  }
  pairs.sort((a, b) => b.alias.length - a.alias.length)

  const used = new Set<string>()
  const normHeaders = headers.map((h) => norm(h))
  const out: (string | null)[] = headers.map(() => null)

  // Pass 1 — exact header = key / label / alias
  normHeaders.forEach((n, i) => {
    if (!n) return
    const hit = pairs.find((p) => p.alias === n && !used.has(p.field.key))
    if (hit) { out[i] = hit.field.key; used.add(hit.field.key) }
  })

  // Pass 2 — fuzzy containment
  normHeaders.forEach((n, i) => {
    if (out[i] || !n || n.length < 4) return
    // 2a. header contains an alias ("Reasonable Fit % (34% & above)" ⊃ "reasonablefit")
    const contains = pairs.filter((p) => !used.has(p.field.key) && p.alias.length >= 4 && n.includes(p.alias))
    if (contains.length > 0) {
      const best = contains.reduce((a, b) => (b.alias.length > a.alias.length ? b : a))
      out[i] = best.field.key
      used.add(best.field.key)
      return
    }
    // 2b. an alias contains the header ("approveddate" ⊃ "approved") — agent
    // fields come last so working fields win ambiguous headers like "status".
    const inside = pairs
      .filter((p) => !used.has(p.field.key) && n.length >= 5 && p.alias.includes(n))
      .sort((a, b) => (Number(a.field.agent ?? false) - Number(b.field.agent ?? false)) || a.alias.length - b.alias.length)
    if (inside.length > 0) {
      out[i] = inside[0].field.key
      used.add(inside[0].field.key)
    }
  })

  // Pass 3 — nothing stays unmapped: leftovers land in the Description collector
  return out.map((v) => v ?? EXTRA_KEY)
}

type Step = 'upload' | 'map' | 'done'

interface ImportResult {
  created: number
  updated: number
  skipped: number
  failed: number
  listingsAdded?: number
  accountsCreated?: number
  errors: { row: number; reason: string }[]
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  module: ImportModule
  moduleLabel: string
  onImported: () => void
}

export function ImportWizard({ open, onOpenChange, module, moduleLabel, onImported }: Props) {
  const { canImportExport } = usePermissions()
  const [step, setStep] = React.useState<Step>('upload')
  const [file, setFile] = React.useState<File | null>(null)
  const [parsing, setParsing] = React.useState(false)
  const [table, setTable] = React.useState<ParsedTable | null>(null)
  const [mapping, setMapping] = React.useState<(string | null)[]>([])
  // Default ON — re-imports refresh known records instead of skipping them
  // ("no skip while importing"); turn it off to keep duplicates out.
  const [updateExisting, setUpdateExisting] = React.useState(true)
  const [importing, setImporting] = React.useState(false)
  const [result, setResult] = React.useState<ImportResult | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const [progress, setProgress] = React.useState({ done: 0, total: 0 })
  const [batchError, setBatchError] = React.useState<string | null>(null)
  const [stopped, setStopped] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const cancelRef = React.useRef(false)

  const fields = MODULE_FIELDS[module]
  const csvFields = fields.filter((f) => !f.agent)
  const agentFields = fields.filter((f) => f.agent)

  const reset = () => {
    // updateExisting keeps the no-skip default (true) on every reset so
    // re-imports always refresh known records instead of skipping them.
    setStep('upload'); setFile(null); setTable(null); setMapping([]); setResult(null); setUpdateExisting(true); setParsing(false); setImporting(false)
    setProgress({ done: 0, total: 0 }); setBatchError(null); setStopped(false)
    cancelRef.current = false
  }

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      // Closing the dialog mid-import stops the loop at the next batch
      // boundary — batches already processed stay imported.
      cancelRef.current = true
      reset()
    }
    onOpenChange(v)
  }

  const handleFile = async (f: File) => {
    setFile(f)
    setParsing(true)
    setResult(null)
    try {
      const t = await parseImportFile(f)
      if (t.rows.length === 0 || t.headers.length === 0) {
        toast.error(t.meta.warnings[0] ?? 'No data rows found in this file')
        setParsing(false)
        return
      }
      if (t.rows.length > MAX_IMPORT_FILE_ROWS) {
        toast.error(`This file has ${t.rows.length.toLocaleString()} rows — the limit is ${MAX_IMPORT_FILE_ROWS.toLocaleString()}. Split it into smaller files.`)
        setParsing(false)
        return
      }
      setTable(t)
      setMapping(autoMap(t.headers, module))
      setStep('map')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read file')
    } finally {
      setParsing(false)
    }
  }

  const requiredMissing = fields
    .filter((f) => f.required && !mapping.includes(f.key) && !(f.key === 'firstName' && mapping.includes('fullName')))
    .map((f) => f.label)

  const mappedCount = mapping.filter(Boolean).length

  const downloadTemplate = () => {
    const header = fields.map((f) => f.label.split(' — ')[0])
    const example = fields.map((f) => f.example)
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const csv = '\uFEFF' + [header.map(esc).join(','), example.map(esc).join(',')].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${module}-import-template.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const runImport = async () => {
    if (!table) return
    setImporting(true)
    setBatchError(null)
    setStopped(false)
    cancelRef.current = false
    // Build the mapped row objects once — columns mapped to the collector are
    // folded into Description as "Header: value" lines; nothing is dropped.
    const rows = table.rows.map((cells) => {
      const obj: Record<string, unknown> = {}
      const extraLines: string[] = []
      cells.forEach((cell, idx) => {
        const key = mapping[idx]
        if (!key || cell === '') return
        if (key === EXTRA_KEY) {
          extraLines.push(`${table.headers[idx] || 'Column ' + (idx + 1)}: ${cell}`)
          return
        }
        obj[key] = cell
      })
      if (extraLines.length > 0) {
        const base = typeof obj.description === 'string' && obj.description ? obj.description : ''
        obj.description = [base, ...extraLines].join('\n')
      }
      return obj
    })
    const total = rows.length
    let processed = 0
    setProgress({ done: 0, total })
    // Aggregated across batches — every batch response carries the same shape
    // as the old single-request import, so the result screen works unchanged.
    const agg: ImportResult = { created: 0, updated: 0, skipped: 0, failed: 0, listingsAdded: 0, accountsCreated: 0, errors: [] }
    let error: string | null = null
    let wasStopped = false
    // Batches run strictly IN ORDER on purpose: each request re-fetches the
    // org's existing records, so a contact created in an earlier batch is
    // found by later batches and its extra listings land in the history —
    // the listing-intelligence semantics of the old single request hold.
    for (let i = 0; i < total; i += IMPORT_BATCH_SIZE) {
      if (cancelRef.current) { wasStopped = true; break }
      const end = Math.min(i + IMPORT_BATCH_SIZE, total)
      // A transient failure (network blip, dev-server restart) retries the
      // same batch — the API is idempotent (dedupe + refresh semantics), so
      // a retried batch can never duplicate records.
      let batchResult: any = null
      let lastFailure = ''
      for (let attempt = 0; attempt < 3 && !batchResult; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt))
        try {
          const res = await fetch('/api/crm/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ module, rows: rows.slice(i, end), updateExisting }),
          })
          const json = await res.json().catch(() => null)
          if (!res.ok || !json || typeof json.created !== 'number') {
            lastFailure = (json && json.error) || `Batch ${Math.floor(i / IMPORT_BATCH_SIZE) + 1} failed (rows ${i + 1}–${end})`
            // Client errors (auth, bad module) will never succeed on retry.
            if (res.status === 400 || res.status === 401 || res.status === 403) break
          } else {
            batchResult = json
          }
        } catch {
          lastFailure = `Network error on batch ${Math.floor(i / IMPORT_BATCH_SIZE) + 1} (rows ${i + 1}–${end})`
        }
      }
      if (!batchResult) { error = lastFailure || `Batch ${Math.floor(i / IMPORT_BATCH_SIZE) + 1} failed`; break }
      agg.created += batchResult.created ?? 0
      agg.updated += batchResult.updated ?? 0
      agg.skipped += batchResult.skipped ?? 0
      agg.failed += batchResult.failed ?? 0
      agg.listingsAdded = (agg.listingsAdded ?? 0) + (batchResult.listingsAdded ?? 0)
      agg.accountsCreated = (agg.accountsCreated ?? 0) + (batchResult.accountsCreated ?? 0)
      if (Array.isArray(batchResult.errors)) for (const e of batchResult.errors) agg.errors.push(e)
      processed = end
      setProgress({ done: end, total })
    }
    if (cancelRef.current) wasStopped = true
    if (agg.errors.length > 200) agg.errors = agg.errors.slice(0, 200)
    setResult(agg)
    setBatchError(error)
    setStopped(wasStopped && !error)
    if (error) {
      // Rows processed before the failure are safely imported — show the
      // partial summary plus what went wrong instead of a dead end.
      setStep('done')
      onImported()
      toast.error(error)
    } else if (wasStopped && processed === 0) {
      toast.message('Import stopped — nothing was imported')
    } else {
      setStep('done')
      onImported()
      toast.success(`Imported ${agg.created} record${agg.created === 1 ? '' : 's'}`)
    }
    setImporting(false)
  }

  const previewRows = table?.rows.slice(0, 5) ?? []
  // Preview columns follow the FILE's column order and include the extras
  // collector so users see exactly what will land in the record.
  const previewCols = table
    ? table.headers
        .map((h, idx) => {
          const key = mapping[idx]
          if (!key) return null
          const label = key === EXTRA_KEY ? EXTRA_LABEL : (fields.find((f) => f.key === key)?.label ?? key)
          return { idx, label }
        })
        .filter((c): c is { idx: number; label: string } => c !== null)
    : []

  // Admin-only gate: while locked, the wizard renders a compact locked card
  // instead of the upload/mapping UI — there is no way to proceed.
  const locked = !canImportExport

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="size-5 text-primary" />
            Import {moduleLabel}
          </DialogTitle>
          <DialogDescription>
            Upload a file and map its columns — supported: {ACCEPTED_IMPORT_LABEL}. Big files are imported in automatic batches with live progress.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable body — keeps the header and footer visible no matter how
            much mapping/preview content a CSV produces. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
        {locked && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <Lock className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Import is available to Admin users only.</p>
          </div>
        )}

        {!locked && step === 'upload' && (
          <div className="space-y-4">
            <div
              role="button"
              tabIndex={0}
              aria-label={`Upload ${moduleLabel} file`}
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}`}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const f = e.dataTransfer.files?.[0]
                if (f) handleFile(f)
              }}
            >
              {parsing ? (
                <><Loader2 className="size-10 animate-spin text-primary" /><p className="text-sm font-medium">Reading {file?.name}…</p></>
              ) : (
                <>
                  <FileSpreadsheet className="size-10 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop your file here or click to browse</p>
                  <p className="text-xs text-muted-foreground">{ACCEPTED_IMPORT_LABEL}</p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_IMPORT_TYPES}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Every column is picked automatically — anything without a CRM field is folded into Description · same company → one account · same email + a NEW listing link → a listing is added.</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={downloadTemplate}>
                <Download className="mr-1 size-3.5" /> Sample CSV template
              </Button>
            </div>
          </div>
        )}

        {!locked && step === 'map' && table && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary" className="min-w-0 max-w-full gap-1"><FileText className="size-3 shrink-0" /><span className="truncate">{file?.name}</span></Badge>
              <Badge variant="outline">{table.rows.length.toLocaleString()} rows</Badge>
              <Badge variant="outline">{table.headers.length} columns</Badge>
              {table.meta.sheets && table.meta.sheets.length > 1 && (
                <Badge variant="outline">sheet: {table.meta.sheets[0]}</Badge>
              )}
              <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={reset}>
                <X className="mr-1 size-3.5" /> Choose another file
              </Button>
            </div>

            {table.meta.warnings.length > 0 && (
              <Alert className="border-amber-500/40 bg-amber-500/5">
                <AlertTriangle className="size-4 text-amber-600" />
                <AlertDescription className="text-xs">
                  {table.meta.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">Map columns</p>
                <Badge variant="secondary" className="gap-1 text-xs"><Sparkles className="size-3 text-primary" aria-hidden /> Auto-filled from your file</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 text-xs"
                  onClick={() => setMapping(autoMap(table.headers, module))}
                  title="Reset every column to the auto-detected target field"
                >
                  <Wand2 className="mr-1 size-3.5" /> Re-run auto-fill
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {mappedCount === table.headers.length
                  ? `All ${table.headers.length} columns auto-picked — nothing skipped. Adjust anything before importing; each row becomes one ${moduleLabel.toLowerCase().replace(/s$/, '')}.`
                  : `Auto-filled ${mappedCount} of ${table.headers.length} columns — adjust anything before importing. Each row becomes one ${moduleLabel.toLowerCase().replace(/s$/, '')}.`}
              </p>
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                <div className="divide-y">
                  {table.headers.map((h, idx) => (
                    <div key={idx} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{h}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          e.g. {table.rows[0]?.[idx]?.slice(0, 40) || '—'}
                        </p>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      <Select
                        value={mapping[idx] ?? EXTRA_KEY}
                        onValueChange={(v) => {
                          setMapping((m) => {
                            const next = [...m]
                            next[idx] = v
                            // Prevent double-mapping the same target field — the
                            // column that loses the field falls back to the
                            // Description collector, never to "skip".
                            if (v !== EXTRA_KEY) {
                              next.forEach((val, j) => {
                                if (j !== idx && val !== null && val === v) next[j] = EXTRA_KEY
                              })
                            }
                            return next
                          })
                        }}
                      >
                        <SelectTrigger className="w-40 shrink-0 sm:w-56" aria-label={`Map column ${h}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">No CRM field — folded into Description</SelectLabel>
                            <SelectItem value={EXTRA_KEY}>{EXTRA_LABEL}</SelectItem>
                          </SelectGroup>
                          {csvFields.length > 0 && (
                            <SelectGroup>
                              <SelectLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">From your CSV file</SelectLabel>
                              {csvFields.map((f) => (
                                <SelectItem key={f.key} value={f.key}>
                                  {f.label}{f.required ? ' *' : ''}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                          {agentFields.length > 0 && (
                            <SelectGroup>
                              <SelectLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">Left blank — filled by the sales agent</SelectLabel>
                              {agentFields.map((f) => (
                                <SelectItem key={f.key} value={f.key}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
              {agentFields.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <UserCheck className="size-4 text-emerald-600" aria-hidden /> Left blank — filled by the sales agent
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    These sections are not required in your file. They stay empty on import and your sales team fills them in inside the CRM as they work the contact.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {agentFields.filter((f) => !mapping.includes(f.key)).map((f) => (
                      <Badge key={f.key} variant="secondary" className="text-xs">{f.label}</Badge>
                    ))}
                    {agentFields.every((f) => mapping.includes(f.key)) && (
                      <span className="text-xs text-muted-foreground">Your file also carries these columns — mapped above.</span>
                    )}
                  </div>
                </div>
              )}
              {requiredMissing.length > 0 && (
                <Alert className="border-destructive/30 bg-destructive/5">
                  <AlertTriangle className="size-4 text-destructive" />
                  <AlertDescription className="text-xs">
                    Required fields not mapped: <strong>{requiredMissing.join(', ')}</strong>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="update-existing" checked={updateExisting} onCheckedChange={(v) => setUpdateExisting(v === true)} />
              <Label htmlFor="update-existing" className="text-sm">
                Refresh existing records instead of skipping duplicates
              </Label>
            </div>
            {module === 'contact' && updateExisting && (
              <p className="text-xs text-muted-foreground">
                Re-imports refresh Listing Intelligence: rows matching an existing contact by email
                with a NEW listing link always ADD a listing to that contact's history, the exact
                same email+listing link refreshes that listing, and rows without a listing link
                refresh the contact's listing fields. Names, emails, phones and CSM-managed fields
                are never overwritten. Unmatched account names no longer block rows — the company is
                created automatically, so one company always stays one account.
              </p>
            )}

            <div>
              <p className="mb-2 text-sm font-medium">Preview — first {previewRows.length} rows as they will be imported</p>
              <div className="max-h-48 overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                    <tr>
                      {previewCols.map((c) => (
                        <th key={c.idx} className="whitespace-nowrap px-3 py-2 text-left font-medium">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((cells, ri) => (
                      <tr key={ri} className="border-t">
                        {previewCols.map((c) => (
                          <td key={c.idx} className="max-w-40 truncate whitespace-nowrap px-3 py-1.5">{cells[c.idx] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {!locked && step === 'done' && result && (
          <div className="space-y-4">
            {batchError && (
              <Alert className="border-destructive/40 bg-destructive/5">
                <AlertTriangle className="size-4 text-destructive" />
                <AlertDescription className="text-xs">
                  Import stopped early: {batchError}. Everything processed so far is saved — re-run the same file when ready; already-imported rows simply refresh.
                </AlertDescription>
              </Alert>
            )}
            {!batchError && stopped && (
              <Alert className="border-amber-500/40 bg-amber-500/5">
                <AlertTriangle className="size-4 text-amber-600" />
                <AlertDescription className="text-xs">
                  Import paused — {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows were processed. Re-run the same file to continue; already-imported rows simply refresh.
                </AlertDescription>
              </Alert>
            )}
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-8 text-emerald-600" />
              <div>
                <p className="font-semibold">{batchError ? 'Import partially finished' : stopped ? 'Import paused' : 'Import finished'}</p>
                <p className="text-sm text-muted-foreground">{file?.name}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold text-emerald-600">{result.created}</p>
                <p className="text-xs text-muted-foreground">Created</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold text-sky-600">{result.updated}</p>
                <p className="text-xs text-muted-foreground">Updated</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold text-amber-600">{result.skipped}</p>
                <p className="text-xs text-muted-foreground">Duplicates skipped</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold text-destructive">{result.failed}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
              {(result.listingsAdded ?? 0) > 0 && (
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-teal-600">{result.listingsAdded}</p>
                  <p className="text-xs text-muted-foreground">Listings added</p>
                </div>
              )}
              {(result.accountsCreated ?? 0) > 0 && (
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-violet-600">{result.accountsCreated}</p>
                  <p className="text-xs text-muted-foreground">Companies created</p>
                </div>
              )}
            </div>
            {module === 'contact' && (result.listingsAdded ?? 0) > 0 && (
              <p className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <UserCheck className="size-3.5 text-teal-600" aria-hidden />
                Existing recruiters with a new listing link got the listing added to their history — open a contact to see every listing over time. Sales-agent sections (CSM status, next call, reachouts) stay blank for your team to fill in.
              </p>
            )}
            {result.errors.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-medium">Issues ({result.errors.length})</p>
                <div className="max-h-40 overflow-y-auto rounded-lg border">
                  <ul className="divide-y text-xs">
                    {result.errors.slice(0, 50).map((err, i) => (
                      <li key={i} className="px-3 py-1.5">
                        {err.row > 0 && <span className="mr-1.5 font-medium">Row {err.row}:</span>}
                        <span className="text-muted-foreground">{err.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {module === 'contact' && result.created > 0 && (
              <p className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <UserCheck className="size-3.5 text-emerald-600" aria-hidden />
                New contacts were auto-assigned by your assignment rules (session user is the fallback when no rule matched).
              </p>
            )}
          </div>
        )}
        </div>

        {/* Live batch progress — visible while a multi-batch import runs so a
            big file never looks frozen. */}
        {importing && (
          <div className="shrink-0 space-y-1.5 border-t pt-3">
            <Progress value={progress.total > 0 ? (progress.done / progress.total) * 100 : 2} />
            <p className="text-xs text-muted-foreground">
              Batch {Math.min(Math.floor(progress.done / IMPORT_BATCH_SIZE) + 1, Math.max(1, Math.ceil(progress.total / IMPORT_BATCH_SIZE)))} of {Math.max(1, Math.ceil(progress.total / IMPORT_BATCH_SIZE))} · {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows processed
            </p>
          </div>
        )}

        <DialogFooter className="shrink-0">
          {!locked && step === 'map' && (
            <>
              <Button variant="outline" onClick={reset} disabled={importing}>
                <ArrowLeft className="mr-1.5 size-4" /> Back
              </Button>
              {importing && (
                <Button variant="outline" onClick={() => { cancelRef.current = true }}>
                  Stop
                </Button>
              )}
              <Button onClick={runImport} disabled={importing || requiredMissing.length > 0 || mappedCount === 0}>
                {importing ? <><Loader2 className="mr-1.5 size-4 animate-spin" /> Importing {progress.done.toLocaleString()} / {progress.total.toLocaleString()}…</> : <><UploadCloud className="mr-1.5 size-4" /> Import {table?.rows.length.toLocaleString()} rows</>}
              </Button>
            </>
          )}
          {!locked && step === 'done' && (
            <>
              <Button variant="outline" onClick={reset}>Import another file</Button>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </>
          )}
          {(locked || step === 'upload') && (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
