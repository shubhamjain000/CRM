'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { ExternalLink, ClipboardList, Info, Pencil } from 'lucide-react'
import { CrmTable, type Column } from '../crm-table'
import { ImportWizard } from '../import-wizard'
import { useCrmList } from '../use-crm-list'
import { FilterBuilder, condsToParams, describeConds, type FilterCond, type FilterFieldDef } from '../filter-builder'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * Listings board — one row per listing (ContactListing). The column bar is the
 * sales team's daily working set, laid out Zoho-style: every option in its own
 * fixed-width column with vertical dividers and single-line headers:
 *   Listing Title · Date Approved · Applications · Listing URL · Listing Type ·
 *   Visibility · Hired Count · Hiring Status · Created Time ·
 *   Relevant Applications (34% match & above)
 * Sections the import CSV didn't carry (Visibility, Hired Count, Hiring
 * Status…) stay blank ("—") until the sales agent fills them via Edit.
 */

interface Listing {
  id: string
  contactId: string
  accountId: string | null
  url: string | null
  title: string | null
  subtype: string | null
  category: string | null
  recruiterTag: string | null
  premiumStatus: string | null
  visibility: string | null
  hiringStatus: string | null
  totalApplications: number | null
  relevantApplications: number | null
  hiredCount: number | null
  reasonableFitPct: number | null
  dateApproved: string | null
  source: string
  createdAt: string
  lastImportedAt: string
  contactName: string | null
  contactEmails: string
  accountName: string | null
}

const LISTING_TYPES = ['Jobs', 'Internships']
const VISIBILITIES = ['Public', 'Private']
const HIRING_STATUSES = ['Open', 'In Review', 'Filled', 'Closed']
const PREMIUM = ['Free', 'Paid']
const RECRUITER_TAGS = ['New Recruiter', 'Existing Recruiter']

const dash = <span className="text-muted-foreground">—</span>
const fmtDate = (v: string | null | undefined) =>
  v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toLocaleDateString() : null
const fmtDateTime = (v: string | null | undefined) =>
  v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toLocaleString() : null
const fmtNum = (v: number | null | undefined) =>
  v === null || v === undefined ? null : v.toLocaleString()

/** Listing Type pill — Jobs = violet-tinted, Internships = teal-tinted. */
function TypePill({ type }: { type: string | null | undefined }) {
  if (!type) return dash
  const cls = type.toLowerCase() === 'internships'
    ? 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
    : 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{type}</span>
}

/** Visibility pill — Public = emerald, Private = muted. */
function VisibilityPill({ visibility }: { visibility: string | null | undefined }) {
  if (!visibility) return dash
  const isPublic = visibility.toLowerCase() === 'public'
  const cls = isPublic
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : 'bg-muted text-muted-foreground'
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{visibility}</span>
}

/** Hiring Status pill — Open = emerald, In Review = amber, Filled = teal, Closed = muted. */
function HiringStatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return dash
  const lower = status.toLowerCase()
  const cls = lower === 'open'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : lower === 'in review'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
      : lower === 'filled'
        ? 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
        : 'bg-muted text-muted-foreground'
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>
}

/** Truncated, fully clickable listing URL (display truncates, href stays complete). */
function ListingLink({ url }: { url: string | null | undefined }) {
  if (!url) return dash
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      onClick={(e) => e.stopPropagation()}
      className="inline-block max-w-full truncate align-bottom text-primary underline underline-offset-2 hover:opacity-80"
    >
      {url}
    </a>
  )
}

const EMPTY_FILTERS = { subtype: '', visibility: '', hiringStatus: '', premiumStatus: '', recruiterTag: '' }

/** Zoho-style advanced filter fields for listings. */
const LISTING_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'title', label: 'Listing title', type: 'text' },
  { key: 'subtype', label: 'Listing type', type: 'select', options: LISTING_TYPES.map((v) => ({ value: v, label: v })) },
  { key: 'visibility', label: 'Visibility', type: 'select', options: VISIBILITIES.map((v) => ({ value: v, label: v })) },
  { key: 'hiringStatus', label: 'Hiring status', type: 'select', options: HIRING_STATUSES.map((v) => ({ value: v, label: v })) },
  { key: 'premiumStatus', label: 'Premium', type: 'select', options: PREMIUM.map((v) => ({ value: v, label: v })) },
  { key: 'recruiterTag', label: 'Recruiter tag', type: 'select', options: RECRUITER_TAGS.map((v) => ({ value: v, label: v })) },
  { key: 'totalApplications', label: 'Applications', type: 'number' },
  { key: 'relevantApplications', label: 'Relevant applications (34%+)', type: 'number' },
  { key: 'hiredCount', label: 'Hired count', type: 'number' },
  { key: 'dateApproved', label: 'Date approved', type: 'date' },
  { key: 'createdAt', label: 'Created', type: 'date' },
]

/** Sections the sales agent owns — blank on import, filled in the CRM later. */
const AGENT_FIELD_LABELS: Record<string, string> = {
  visibility: 'Visibility',
  hiredCount: 'Hired count',
  hiringStatus: 'Hiring status',
  relevantApplications: 'Relevant applications',
}

interface EditState {
  listing: Listing
  form: {
    title: string; url: string; subtype: string; dateApproved: string
    totalApplications: string; visibility: string; hiredCount: string
    hiringStatus: string; relevantApplications: string
  }
  saving: boolean
}

export function ListingsView() {
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<Record<string, string>>({ ...EMPTY_FILTERS })
  const [filterConds, setFilterConds] = React.useState<FilterCond[]>([])
  const [sort, setSort] = React.useState('-createdAt')
  const [importOpen, setImportOpen] = React.useState(false)
  const [edit, setEdit] = React.useState<EditState | null>(null)

  const filterParams = React.useMemo(() => condsToParams(filterConds), [filterConds])
  const listFilters = React.useMemo(() => ({ ...filters, ...filterParams }), [filters, filterParams])

  const { data, loading, reload, loadMore, loadingMore } = useCrmList<Listing>('/api/crm/listings', {
    search, filters: listFilters, sort, limit: 100,
  })
  const items = data?.items ?? []
  const total = data?.total

  const openEdit = (l: Listing) => {
    setEdit({
      listing: l,
      form: {
        title: l.title ?? '',
        url: l.url ?? '',
        subtype: l.subtype ?? '',
        dateApproved: l.dateApproved ? new Date(l.dateApproved).toISOString().slice(0, 10) : '',
        totalApplications: l.totalApplications?.toString() ?? '',
        visibility: l.visibility ?? '',
        hiredCount: l.hiredCount?.toString() ?? '',
        hiringStatus: l.hiringStatus ?? '',
        relevantApplications: l.relevantApplications?.toString() ?? '',
      },
      saving: false,
    })
  }

  const saveEdit = async () => {
    if (!edit) return
    setEdit((e) => (e ? { ...e, saving: true } : e))
    try {
      const res = await fetch(`/api/crm/listings/${edit.listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit.form),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Failed to save listing')
      toast.success('Listing updated')
      setEdit(null)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save listing')
      setEdit((s) => (s ? { ...s, saving: false } : s))
    }
  }

  const setForm = (patch: Partial<EditState['form']>) =>
    setEdit((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))

  const activeFilters = React.useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = []
    for (const [key, label] of [
      ['subtype', 'Type'], ['visibility', 'Visibility'], ['hiringStatus', 'Hiring status'],
      ['premiumStatus', 'Premium'], ['recruiterTag', 'Recruiter tag'],
    ] as const) {
      if (filters[key]) {
        chips.push({
          key, label: `${label}: ${filters[key]}`,
          onRemove: () => setFilters((f) => ({ ...f, [key]: '' })),
        })
      }
    }
    for (const c of describeConds(filterConds, LISTING_FILTER_FIELDS)) {
      chips.push({
        key: c.key,
        label: c.label,
        onRemove: () => setFilterConds((cs) => cs.filter((x) => x.id !== c.key)),
      })
    }
    return chips
  }, [filters, filterConds])

  // Zoho-style bar — one option per column, fixed widths (px-1.5! overrides the
  // table's default cell padding so each width holds its content on one line),
  // table-fixed so the grid never collapses, columnDividers for the vertical rules.
  const columns: Column<Listing>[] = [
    {
      key: 'title', header: 'Listing Title', sortable: true, className: 'w-60 px-1.5!',
      render: (l) => l.title
        ? <span className="line-clamp-2 font-medium" title={l.title}>{l.title}</span>
        : <span className="inline-flex items-center gap-1.5 text-xs italic text-muted-foreground">To be filled <Pencil className="size-3" aria-hidden="true" /></span>,
      printValue: (l) => l.title ?? '',
    },
    {
      key: 'dateApproved', header: 'Date Approved', sortable: true, className: 'w-32 whitespace-nowrap px-1.5!',
      render: (l) => fmtDate(l.dateApproved) ?? dash,
      printValue: (l) => fmtDate(l.dateApproved) ?? '',
    },
    {
      key: 'totalApplications', header: 'Applications', sortable: true, className: 'w-28 px-1.5! text-right tabular-nums',
      render: (l) => fmtNum(l.totalApplications) ?? dash,
      printValue: (l) => (l.totalApplications ?? '').toString(),
    },
    {
      key: 'url', header: 'Listing URL', className: 'w-40 px-1.5!',
      render: (l) => <ListingLink url={l.url} />,
      printValue: (l) => l.url ?? '',
    },
    {
      key: 'subtype', header: 'Listing Type', sortable: true, className: 'w-32 px-1.5!',
      render: (l) => <TypePill type={l.subtype} />,
      printValue: (l) => l.subtype ?? '',
    },
    {
      key: 'visibility', header: 'Visibility', sortable: true, className: 'w-28 px-1.5!',
      render: (l) => <VisibilityPill visibility={l.visibility} />,
      printValue: (l) => l.visibility ?? '',
    },
    {
      key: 'hiredCount', header: 'Hired Count', sortable: true, className: 'w-28 px-1.5! text-right tabular-nums',
      render: (l) => fmtNum(l.hiredCount) ?? dash,
      printValue: (l) => (l.hiredCount ?? '').toString(),
    },
    {
      key: 'hiringStatus', header: 'Hiring Status', sortable: true, className: 'w-36 px-1.5!',
      render: (l) => <HiringStatusPill status={l.hiringStatus} />,
      printValue: (l) => l.hiringStatus ?? '',
    },
    {
      key: 'createdAt', header: 'Created Time', sortable: true, sortField: 'createdAt', className: 'w-44 whitespace-nowrap px-1.5!',
      render: (l) => fmtDateTime(l.createdAt) ?? dash,
      printValue: (l) => fmtDateTime(l.createdAt) ?? '',
    },
    {
      key: 'relevantApplications', header: 'Relevant Applications (34% match & above)', sortable: true, className: 'w-80 px-1.5! text-right tabular-nums',
      render: (l) => fmtNum(l.relevantApplications) ?? dash,
      printValue: (l) => (l.relevantApplications ?? '').toString(),
    },
    // Context columns — whose listing this is (kept after the requested bar).
    {
      key: 'contactName', header: 'Recruiter', className: 'w-36 px-1.5!',
      render: (l) => l.contactName
        ? <span className="block truncate" title={l.contactName}>{l.contactName}</span>
        : dash,
      printValue: (l) => l.contactName ?? '',
    },
    {
      key: 'accountName', header: 'Company', className: 'w-36 px-1.5!',
      render: (l) => l.accountName
        ? <span className="block truncate" title={l.accountName}>{l.accountName}</span>
        : dash,
      printValue: (l) => l.accountName ?? '',
    },
  ]

  const filterBar = (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <p>
          Sections left blank on import (Visibility, Hired Count, Hiring Status…) wait for the
          sales agent — open a row&apos;s <Pencil className="inline size-3 align-[-1px]" aria-hidden="true" /> menu to fill them in.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Listing type</Label>
        <Select value={filters.subtype || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, subtype: v === 'all' ? '' : v }))}>
          <SelectTrigger size="sm" className="w-full" aria-label="Filter by listing type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {LISTING_TYPES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Visibility</Label>
        <Select value={filters.visibility || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, visibility: v === 'all' ? '' : v }))}>
          <SelectTrigger size="sm" className="w-full" aria-label="Filter by visibility"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {VISIBILITIES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Hiring status</Label>
        <Select value={filters.hiringStatus || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, hiringStatus: v === 'all' ? '' : v }))}>
          <SelectTrigger size="sm" className="w-full" aria-label="Filter by hiring status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {HIRING_STATUSES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Premium</Label>
        <Select value={filters.premiumStatus || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, premiumStatus: v === 'all' ? '' : v }))}>
          <SelectTrigger size="sm" className="w-full" aria-label="Filter by premium status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {PREMIUM.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Recruiter tag</Label>
        <Select value={filters.recruiterTag || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, recruiterTag: v === 'all' ? '' : v }))}>
          <SelectTrigger size="sm" className="w-full" aria-label="Filter by recruiter tag"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {RECRUITER_TAGS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <FilterBuilder
        fields={LISTING_FILTER_FIELDS}
        conds={filterConds}
        onChange={setFilterConds}
      />
    </div>
  )

  const editing = edit?.listing

  return (
    <>
      <CrmTable
        title="Listings"
        endpoint="/api/crm/listings"
        columns={columns}
        tableClassName="table-fixed min-w-[2000px]"
        columnDividers
        search={search}
        onSearchChange={setSearch}
        items={items}
        loading={loading}
        total={total}
        onReload={reload}
        sort={sort}
        onSortChange={setSort}
        filterBar={filterBar}
        filtersActiveCount={activeFilters.length}
        activeFilters={activeFilters}
        onClearFilters={() => { setFilters({ ...EMPTY_FILTERS }); setFilterConds([]) }}
        onImport={() => setImportOpen(true)}
        emptyMessage="No listings yet — import a recruiter CSV to fill this board"
        hasMore={!!data?.nextCursor}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        rowActions={(l) => (
          <>
            <DropdownMenuItem onSelect={() => openEdit(l)}>
              <Pencil className="mr-2 size-3.5" /> Edit / fill details
            </DropdownMenuItem>
            {l.url && (
              <DropdownMenuItem onSelect={() => window.open(l.url!, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="mr-2 size-3.5" /> Open listing URL
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-muted-foreground" disabled>
              <ClipboardList className="mr-2 size-3.5" /> Source: {l.source}
            </DropdownMenuItem>
          </>
        )}
      />

      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        module="contact"
        moduleLabel="Contacts & Listings"
        onImported={reload}
      />

      {/* Sales-agent fill-in dialog — blank sections stay blank until filled */}
      <Dialog open={!!edit} onOpenChange={(v) => { if (!v) setEdit(null) }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit listing</DialogTitle>
            <DialogDescription>
              {editing?.title || editing?.contactName || 'Listing'} · leave a section blank if it is
              still to be filled by the sales agent.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="listing-title">Listing Title</Label>
                <Input id="listing-title" value={edit.form.title} onChange={(e) => setForm({ title: e.target.value })} placeholder="e.g. Software Engineer Intern" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="listing-url">Listing URL</Label>
                <Input id="listing-url" value={edit.form.url} onChange={(e) => setForm({ url: e.target.value })} placeholder="https://…" inputMode="url" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-type">Listing Type</Label>
                <Select value={edit.form.subtype || 'blank'} onValueChange={(v) => setForm({ subtype: v === 'blank' ? '' : v })}>
                  <SelectTrigger id="listing-type" size="sm" className="w-full"><SelectValue placeholder="Blank" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blank">Blank</SelectItem>
                    {LISTING_TYPES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-approved">Date Approved</Label>
                <Input id="listing-approved" type="date" value={edit.form.dateApproved} onChange={(e) => setForm({ dateApproved: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-apps">Applications</Label>
                <Input id="listing-apps" type="number" min="0" value={edit.form.totalApplications} onChange={(e) => setForm({ totalApplications: e.target.value })} placeholder="—" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-relevant">Relevant Applications <span className="font-normal text-muted-foreground">(34% match &amp; above)</span></Label>
                <Input id="listing-relevant" type="number" min="0" value={edit.form.relevantApplications} onChange={(e) => setForm({ relevantApplications: e.target.value })} placeholder="—" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-visibility">Visibility <span className="font-normal text-muted-foreground">(agent)</span></Label>
                <Select value={edit.form.visibility || 'blank'} onValueChange={(v) => setForm({ visibility: v === 'blank' ? '' : v })}>
                  <SelectTrigger id="listing-visibility" size="sm" className="w-full"><SelectValue placeholder="Blank" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blank">Blank</SelectItem>
                    {VISIBILITIES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-hired">Hired Count <span className="font-normal text-muted-foreground">(agent)</span></Label>
                <Input id="listing-hired" type="number" min="0" value={edit.form.hiredCount} onChange={(e) => setForm({ hiredCount: e.target.value })} placeholder="—" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-hiring">Hiring Status <span className="font-normal text-muted-foreground">(agent)</span></Label>
                <Select value={edit.form.hiringStatus || 'blank'} onValueChange={(v) => setForm({ hiringStatus: v === 'blank' ? '' : v })}>
                  <SelectTrigger id="listing-hiring" size="sm" className="w-full"><SelectValue placeholder="Blank" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blank">Blank</SelectItem>
                    {HIRING_STATUSES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {Object.keys(AGENT_FIELD_LABELS).length > 0 && (
                <div className="sm:col-span-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-medium">Agent-owned:</span>
                    {(['visibility', 'hiredCount', 'hiringStatus'] as const).map((k) => (
                      <Badge key={k} variant="outline" className="px-1.5 py-0 text-[10px]">{AGENT_FIELD_LABELS[k]}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={edit?.saving}>
              {edit?.saving ? 'Saving…' : 'Save listing'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
