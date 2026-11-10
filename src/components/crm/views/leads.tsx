'use client'

import * as React from 'react'
import { Trash2, ArrowRightLeft, Edit, Mail, MessageCircle, UserCog } from 'lucide-react'
import { VirtualList, type Column } from '../virtual-list'
import { RecordForm, type FieldDef } from '../record-form'
import { DetailView } from '../detail-view'
import { LeadScorePanel } from '../lead-score-panel'
import { ConversionWizard } from '../conversion-wizard'
import { ImportWizard } from '../import-wizard'
import { CallButton } from '../call-dialer'
import { useCrmList, createRecord, updateRecord, deleteRecord, notify } from '../use-crm-list'
import { useFieldSecurity, securityKey } from '../use-field-security'
import { FilterBuilder, condsToParams, describeConds, type FilterCond, type FilterFieldDef } from '../filter-builder'
import { useRecordNav } from '@/store/record-nav'
import { safeJsonParse } from '@/components/safe-json'
import { OwnerCell, useOrgMembers, firstPhone, buildWhatsappUrl, logOutreach } from '../owner'
import { ComposeEmailDialog } from '../compose-email-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface Lead {
  id: string; firstName: string; lastName: string; company: string | null
  leadStatus: string; rating: string | null; score: number; leadSource: string | null
  industry: string | null; createdAt: string; emails?: string; phones?: string
  website?: string | null; description?: string | null; annualRevenue?: number | null
  employees?: number | null; title?: string | null
  ownerId?: string
}

const LEAD_SOURCES = [
  'Advertisement', 'Cold Call', 'Employee Referral', 'External Referral',
  'Online Store', 'Partner', 'Public Relations', 'Seminar Partner',
  'Trade Show', 'Web Download', 'Web Research', 'Chat',
]

const STATUS_BADGE: Record<string, string> = {
  new: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
  contacted: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  qualified: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  unqualified: 'border-muted-foreground/30 text-muted-foreground',
  converted: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
}

/** Column key → field-security catalog keys. A column is dropped when ALL of
 *  its mapped keys are hidden for the caller's role (field-security Tier 3). */
const LEAD_COLUMN_SECURITY_KEYS: Record<string, string[]> = {
  name: ['firstName', 'lastName'],
  leadStatus: ['leadStatus'],
  owner: ['ownerId'],
  rating: ['rating'],
  score: ['score'],
  leadSource: ['leadSource'],
  phone: ['phones'],
  industry: ['industry'],
}

export function LeadsView() {
  const [search, setSearch] = React.useState('')
  const [detailLead, setDetailLead] = React.useState<Lead | null>(null)
  const [convertLead, setConvertLead] = React.useState<Lead | null>(null)
  const [importOpen, setImportOpen] = React.useState(false)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Lead | null>(null)
  const [editingCustom, setEditingCustom] = React.useState<Record<string, unknown> | null>(null)
  const [savedViews, setSavedViews] = React.useState<{ id: string; name: string; isDefault: boolean; config: Record<string, unknown> }[]>([])
  const [ownerFilter, setOwnerFilter] = React.useState('')
  const [filterConds, setFilterConds] = React.useState<FilterCond[]>([])
  const [compose, setCompose] = React.useState<{ to: string; record: Lead } | null>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const filterParams = React.useMemo(() => condsToParams(filterConds), [filterConds])
  const listFilters = React.useMemo(
    () => ({ ...(ownerFilter ? { ownerId: ownerFilter } : {}), ...filterParams }),
    [ownerFilter, filterParams],
  )
  const { data, loading, reload } = useCrmList<Lead>('/api/crm/leads', {
    search,
    filters: listFilters,
  })
  const { members, nameById } = useOrgMembers()
  // Field security (Tier 3): drop columns hidden for the caller's role and
  // disable inline editing on read-only ones (server enforces regardless).
  const { hiddenFor, isReadOnly } = useFieldSecurity()

  // Load saved views
  React.useEffect(() => {
    fetch('/api/crm/saved-views?module=lead', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setSavedViews(d.views ?? []))
      .catch(() => {})
  }, [])

  const leadName = (r: Lead) => [r.firstName, r.lastName].filter(Boolean).join(' ') || 'this lead'

  /** Zoho-style filterable fields for the advanced filter builder. */
  const LEAD_FILTER_FIELDS: FilterFieldDef[] = [
    { key: 'ownerId', label: 'Owner', type: 'select', options: members.map((m) => ({ value: m.id, label: m.name })) },
    { key: 'leadStatus', label: 'Lead status', type: 'select',
      options: ['new', 'contacted', 'qualified', 'unqualified', 'converted']
        .map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })) },
    { key: 'rating', label: 'Rating', type: 'select',
      options: ['hot', 'warm', 'cold'].map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) })) },
    { key: 'leadSource', label: 'Lead source', type: 'select', options: LEAD_SOURCES.map((s) => ({ value: s, label: s })) },
    { key: 'industry', label: 'Industry', type: 'text' },
    { key: 'company', label: 'Company', type: 'text' },
    { key: 'score', label: 'Score', type: 'number' },
    { key: 'annualRevenue', label: 'Annual revenue', type: 'number' },
    { key: 'employees', label: 'Employees', type: 'number' },
    { key: 'isConverted', label: 'Converted', type: 'boolean' },
    { key: 'createdAt', label: 'Created', type: 'date' },
    { key: 'lastActivity', label: 'Last activity', type: 'date' },
  ]

  /** Reassign a lead to another owner (validated server-side). */
  const changeOwner = async (id: string, ownerId: string) => {
    const member = nameById.get(ownerId)
    try {
      await updateRecord('/api/crm/leads', id, { ownerId })
      toast.success(`Owner updated — ${member ?? 'new owner'}`)
      reload()
      if (detailLead?.id === id) await openLeadById(id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change the owner')
    }
  }

  /** Bulk reassign selected leads (bulk-update endpoint, validated server-side). */
  const bulkAssign = async (ids: string[], ownerId: string, clear: () => void) => {
    try {
      const res = await fetch('/api/crm/leads/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, data: { ownerId } }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Bulk assign failed')
      toast.success(`${json?.count ?? ids.length} lead${ids.length === 1 ? '' : 's'} assigned to ${nameById.get(ownerId) ?? 'owner'}`)
      clear()
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk assign failed')
    }
  }

  /** Open WhatsApp for the lead's first phone; the visit is logged on the timeline. */
  const openWhatsapp = async (r: Lead) => {
    const phone = firstPhone(r.phones)
    if (!phone) { toast.error('This lead has no phone number'); return }
    const url = buildWhatsappUrl(phone, `Hi ${r.firstName || 'there'}, following up from Unstop — is this a good time to talk?`)
    if (!url) { toast.error(`Could not build a WhatsApp link for ${phone}`); return }
    window.open(url, '_blank', 'noopener')
    await logOutreach({ module: 'lead', recordId: r.id, channel: 'whatsapp', description: `WhatsApp chat opened · ${phone}` })
    toast.info(`WhatsApp opened for ${leadName(r)} · ${phone} — logged on the timeline`)
  }

  /** Open the email composer pre-filled with the lead's first email. */
  const openEmail = (r: Lead) => {
    const to = safeJsonParse<string[]>(r.emails ?? '[]', [])[0] ?? ''
    if (!to) { toast.error('This lead has no email address'); return }
    setCompose({ to, record: r })
  }

  const columns: Column<Lead>[] = [
    { key: 'name', header: 'Name', width: 200, render: (r) => (
      <div><p className="font-medium">{r.firstName} {r.lastName}</p><p className="text-xs text-muted-foreground">{r.company ?? '—'}</p></div>
    ) },
    { key: 'leadStatus', header: 'Status', width: 120, editable: true, render: (r) => (
      <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[r.leadStatus] ?? ''}`}>{r.leadStatus}</span>
    ) },
    { key: 'owner', header: 'Owner', width: 140, render: (r) => (
      <OwnerCell ownerId={r.ownerId} nameById={nameById} />
    ) },
    { key: 'rating', header: 'Rating', width: 90, editable: true, render: (r) => r.rating ? <span className="capitalize">{r.rating}</span> : '—' },
    { key: 'score', header: 'Score', width: 80, editable: true, render: (r) => <span className="font-mono text-xs">{r.score}</span> },
    { key: 'leadSource', header: 'Source', width: 130, editable: true, render: (r) => r.leadSource ?? '—' },
    { key: 'phone', header: 'Phone', width: 180, render: (r) => (
      <CallButton
        phone={firstPhone(r.phones)}
        name={[r.firstName, r.lastName].filter(Boolean).join(' ')}
        module="lead"
        recordId={r.id}
      />
    ) },
    { key: 'industry', header: 'Industry', width: 130, editable: true, render: (r) => r.industry ?? '—' },
    { key: 'createdAt', header: 'Created', width: 120, render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</span> },
  ]

  // Field security: hidden columns removed, read-only columns lose inline edit.
  const hiddenLead = hiddenFor('lead')
  const visibleColumns: Column<Lead>[] = columns
    .filter((c) => {
      const keys = LEAD_COLUMN_SECURITY_KEYS[c.key]
      return !keys || keys.length === 0 || !keys.every((k) => hiddenLead.has(k))
    })
    .map((c) => (
      c.editable && isReadOnly('lead', securityKey(c.key)) ? { ...c, editable: false } : c
    ))

  const onInlineEdit = async (id: string, field: string, value: string) => {
    await updateRecord('/api/crm/leads', id, { [field]: value })
    reload()
  }

  const openNew = () => { setEditing(null); setEditingCustom(null); setFormOpen(true) }

  const openEdit = async (lead: Lead) => {
    setEditing(lead)
    setEditingCustom(null)
    setFormOpen(true)
    try {
      const res = await fetch(`/api/crm/leads/${lead.id}`, { cache: 'no-store' })
      if (res.ok) {
        const full = await res.json()
        if (full?.customFields && Object.keys(full.customFields).length > 0) setEditingCustom(full.customFields)
      }
    } catch { /* form still opens without custom prefill */ }
  }

  const save = async (vals: Record<string, unknown>) => {
    const email = vals.email ? [String(vals.email)] : []
    const phone = vals.phone ? [String(vals.phone)] : []
    const payload: Record<string, unknown> = { ...vals, emails: JSON.stringify(email), phones: JSON.stringify(phone) }
    delete payload.email; delete payload.phone
    if (!payload.ownerId) delete payload.ownerId // empty = assignment rule
    if (editing) { await updateRecord('/api/crm/leads', editing.id, payload); toast.success('Lead updated') }
    else { await createRecord('/api/crm/leads', payload); toast.success('Lead created') }
    reload()
  }

  // Big sectioned form — Zoho-style
  const FIELDS: FieldDef[] = [
    // Lead Information
    { key: 'firstName', label: 'First name', type: 'text', required: true, section: 'Lead Information' },
    { key: 'lastName', label: 'Last name', type: 'text', required: true, section: 'Lead Information' },
    { key: 'company', label: 'Company', type: 'text', section: 'Lead Information' },
    { key: 'title', label: 'Title', type: 'text', section: 'Lead Information' },
    { key: 'ownerId', label: 'Owner', type: 'select', clearable: true, section: 'Lead Information',
      hint: editing ? 'Leave empty to keep the current owner.' : 'Leave empty to auto-assign via the round-robin assignment rule.',
      options: members.map((m) => ({ value: m.id, label: m.name })) },
    { key: 'leadSource', label: 'Lead source', type: 'select', clearable: true, section: 'Lead Information',
      options: LEAD_SOURCES.map((s) => ({ value: s, label: s })) },
    { key: 'leadStatus', label: 'Lead status', type: 'select', section: 'Lead Information',
      options: ['new', 'contacted', 'qualified', 'unqualified', 'converted']
        .map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })) },
    { key: 'rating', label: 'Rating', type: 'select', clearable: true, section: 'Lead Information',
      options: ['hot', 'warm', 'cold'].map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) })) },
    // Contact Details
    { key: 'email', label: 'Email', type: 'email', section: 'Contact Details' },
    { key: 'phone', label: 'Phone', type: 'phone', section: 'Contact Details' },
    { key: 'website', label: 'Website', type: 'url', section: 'Contact Details' },
    // Company Details
    { key: 'industry', label: 'Industry', type: 'text', section: 'Company Details' },
    { key: 'annualRevenue', label: 'Annual revenue', type: 'currency', section: 'Company Details', placeholder: '0.00' },
    { key: 'employees', label: 'Employees', type: 'number', section: 'Company Details' },
    // Description Information
    { key: 'description', label: 'Description', type: 'textarea', section: 'Description Information' },
  ]

  const initial = editing ? {
    firstName: editing.firstName, lastName: editing.lastName, company: editing.company ?? '',
    title: editing.title ?? '', leadSource: editing.leadSource ?? '',
    ownerId: editing.ownerId ?? '',
    leadStatus: editing.leadStatus, rating: editing.rating ?? '',
    email: safeJsonParse<string[]>(editing.emails, [])[0] ?? '',
    phone: safeJsonParse<string[]>(editing.phones, [])[0] ?? '',
    website: editing.website ?? '', industry: editing.industry ?? '',
    annualRevenue: editing.annualRevenue ?? '', employees: editing.employees ?? '',
    description: editing.description ?? '',
  } : { leadStatus: 'new', ownerId: '' }

  const saveView = async (name: string, isShared: boolean) => {
    try {
      // Persist the FULL filter state (search + quick filters + builder conds).
      await createRecord('/api/crm/saved-views', {
        module: 'lead', name, isShared,
        config: { search, filters: ownerFilter ? { ownerId: ownerFilter } : undefined, conds: filterConds },
      })
      toast.success('Filter saved')
      const res = await fetch('/api/crm/saved-views?module=lead', { cache: 'no-store' })
      const d = await res.json()
      setSavedViews(d.views ?? [])
      return true
    } catch (e) {
      // Surface the thrown message (e.g. the 10-filters-per-module cap).
      toast.error(e instanceof Error ? e.message : 'Failed to save filter')
      return false
    }
  }

  /** Delete a saved filter and refresh the list. */
  const deleteSavedView = async (id: string) => {
    try {
      await fetch(`/api/crm/saved-views/${id}`, { method: 'DELETE' })
      toast.success('Filter deleted')
      const res = await fetch('/api/crm/saved-views?module=lead', { cache: 'no-store' })
      const d = await res.json()
      setSavedViews(d.views ?? [])
    } catch {
      toast.error('Failed to delete filter')
    }
  }

  /** Apply a saved view's FULL config — search + quick filters + builder conds. */
  const applyView = (v: { name: string; config: Record<string, unknown> }) => {
    const cfg = v.config ?? {}
    setSearch(String(cfg.search ?? ''))
    const filters = (cfg.filters ?? null) as Record<string, unknown> | null
    setOwnerFilter(filters?.ownerId ? String(filters.ownerId) : '')
    setFilterConds(Array.isArray(cfg.conds) ? cfg.conds as FilterCond[] : [])
    toast.info(`View applied — ${v.name}`)
  }

  /** Open a lead by id — powers the Previous / Next arrows and global search deep-links. */
  const openLeadById = React.useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/crm/leads/${id}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const full = await res.json()
      if (!full?.id) throw new Error()
      setDetailLead(full)
    } catch {
      toast.error('Could not open that lead')
    }
  }, [])

  // Jump straight into a record when requested from the global search palette.
  React.useEffect(() => {
    const hit = useRecordNav.getState().consumeRecord('lead')
    if (hit) void openLeadById(hit.id)
  }, [openLeadById])

  // Notification deep-link: 'unstop:navigate' stashes the record id here before
  // switching views — open it once, then clear the key.
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem('unstop:open-record')
      if (!raw) return
      const hit = JSON.parse(raw) as { module?: string; id?: string }
      if (hit.module === 'lead' && hit.id) {
        sessionStorage.removeItem('unstop:open-record')
        void openLeadById(hit.id)
      }
    } catch { /* malformed key — ignore */ }
  }, [openLeadById])

  /** Owner picker shared by the row menu and the detail header. */
  const ownerMenuItems = (lead: Lead, onDone?: () => void) => (
    <>
      {members.map((m) => (
        <DropdownMenuItem
          key={m.id}
          disabled={lead.ownerId === m.id}
          onClick={() => { void changeOwner(lead.id, m.id); onDone?.() }}
        >
          {m.name}
          {lead.ownerId === m.id && <span className="ml-auto text-xs text-muted-foreground">current</span>}
        </DropdownMenuItem>
      ))}
    </>
  )

  // Detail view mode
  if (detailLead) {
    const emails = safeJsonParse<string[]>(detailLead.emails, [])
    const phones = safeJsonParse<string[]>(detailLead.phones, [])
    const phone = phones[0] ?? ''
    return (
      <>
        <DetailView
          module="lead"
          recordId={detailLead.id}
          recordName={`${detailLead.firstName} ${detailLead.lastName}`}
          onBack={() => setDetailLead(null)}
          onEdit={() => { setDetailLead(null); openEdit(detailLead) }}
          onNavigateRecord={(id) => { void openLeadById(id) }}
          onFieldEdit={async (field, value) => { await onInlineEdit(detailLead.id, field, value) }}
          headerActions={
            <>
              <Button variant="outline" size="sm" onClick={() => openEmail(detailLead)} title="Email this lead" disabled={!emails[0]}>
                <Mail className="mr-1.5 size-3.5" /> Email
              </Button>
              <Button variant="outline" size="sm" onClick={() => void openWhatsapp(detailLead)} title="Open WhatsApp chat" disabled={!phone}>
                <MessageCircle className="mr-1.5 size-3.5" /> WhatsApp
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" title="Change owner">
                    <UserCog className="mr-1.5 size-3.5" /> {nameById.get(detailLead.ownerId ?? '') ?? 'Owner'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                  {ownerMenuItems(detailLead)}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
          fields={[
            { key: 'firstName', label: 'First name', value: detailLead.firstName, editable: true },
            { key: 'lastName', label: 'Last name', value: detailLead.lastName, editable: true },
            { key: 'company', label: 'Company', value: detailLead.company ?? '', editable: true },
            { key: 'owner', label: 'Owner', value: nameById.get(detailLead.ownerId ?? '') ?? '—' },
            { key: 'email', label: 'Email', value: emails[0] ?? '', editable: true },
            { key: 'phone', label: 'Phone', value: phone, editable: true },
            { key: 'leadStatus', label: 'Status', value: detailLead.leadStatus, editable: true },
            { key: 'rating', label: 'Rating', value: detailLead.rating ?? '', editable: true },
            { key: 'industry', label: 'Industry', value: detailLead.industry ?? '', editable: true },
            { key: 'leadSource', label: 'Source', value: detailLead.leadSource ?? '', editable: true },
            { key: 'score', label: 'Score', value: detailLead.score, editable: true },
            { key: 'website', label: 'Website', value: detailLead.website ?? '', editable: true },
          ]}
          relatedLinks={[
            { label: 'Activities', count: 0 },
            { label: 'Notes', count: 0 },
          ]}
          extraCards={<LeadScorePanel leadId={detailLead.id} />}
        />
        <ComposeEmailDialog
          open={!!compose && compose.record.id === detailLead.id}
          onOpenChange={(v) => { if (!v) setCompose(null) }}
          to={compose?.to ?? ''}
          relatedModule="lead"
          relatedId={detailLead.id}
          recordName={`${detailLead.firstName} ${detailLead.lastName}`}
          company={detailLead.company ?? ''}
          ownerName={nameById.get(detailLead.ownerId ?? '')}
          onSent={() => { void openLeadById(detailLead.id) }}
        />
      </>
    )
  }

  return (
    <>
      <VirtualList
        title="Leads"
        endpoint="/api/crm/leads"
        columns={visibleColumns}
        search={search}
        onSearchChange={setSearch}
        searchInputRef={searchRef}
        onAdd={openNew}
        onRowClick={(r) => setDetailLead(r)}
        onInlineEdit={onInlineEdit}
        items={data?.items ?? null}
        loading={loading}
        total={data?.total}
        onReload={reload}
        savedViews={savedViews}
        onSaveView={saveView}
        onApplyView={applyView}
        onDeleteView={deleteSavedView}
        onImport={() => setImportOpen(true)}
        exportModule="lead"
        exportQuery={Object.keys(listFilters).length > 0 ? listFilters : undefined}
        filterBar={(
          <>
            <Select value={ownerFilter || 'all'} onValueChange={(v) => setOwnerFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-9 w-44" aria-label="Filter by owner">
                <SelectValue placeholder="Owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <FilterBuilder
              fields={LEAD_FILTER_FIELDS}
              conds={filterConds}
              onChange={setFilterConds}
              onSaveFilter={(name) => saveView(name, false)}
              savedCount={savedViews.length}
              triggerClassName="h-9"
            />
          </>
        )}
        filtersActiveCount={(ownerFilter ? 1 : 0) + filterConds.length}
        activeFilters={[
          ...(ownerFilter
            ? [{ key: 'owner', label: `Owner: ${nameById.get(ownerFilter) ?? ownerFilter}`, onRemove: () => setOwnerFilter('') }]
            : []),
          ...describeConds(filterConds, LEAD_FILTER_FIELDS).map((c) => ({
            ...c,
            onRemove: () => setFilterConds((cs) => cs.filter((x) => x.id !== c.key)),
          })),
        ]}
        onClearFilters={() => { setOwnerFilter(''); setFilterConds([]) }}
        bulkActions={(ids, clear) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <UserCog className="mr-1.5 size-3.5" /> Assign owner
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              {members.map((m) => (
                <DropdownMenuItem key={m.id} onClick={() => { void bulkAssign(ids, m.id, clear) }}>
                  {m.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        emptyMessage="No leads yet. Add your first lead or import a file."
        rowActions={(r) => (
          <>
            <DropdownMenuItem onClick={() => setDetailLead(r)}><Edit className="mr-2 size-4" /> Open</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserCog className="mr-2 size-4" /> Change owner
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                {ownerMenuItems(r)}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => openEmail(r)} disabled={!safeJsonParse<string[]>(r.emails ?? '[]', [])[0]}>
              <Mail className="mr-2 size-4" /> Email
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void openWhatsapp(r)}>
              <MessageCircle className="mr-2 size-4" /> WhatsApp
            </DropdownMenuItem>
            {!r.leadStatus.includes('converted') && (
              <DropdownMenuItem onClick={() => setConvertLead(r)}>
                <ArrowRightLeft className="mr-2 size-4" /> Convert
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-destructive" onClick={() => notify(deleteRecord('/api/crm/leads', r.id), { success: 'Moved to trash' }).then(reload)}>
              <Trash2 className="mr-2 size-4" /> Move to trash
            </DropdownMenuItem>
          </>
        )}
      />
      <RecordForm
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'Edit lead' : 'New lead'}
        description={editing ? 'Update lead information and custom fields.' : 'Fill in the lead information. Fields marked * are required.'}
        fields={FIELDS}
        initial={initial}
        module="lead"
        initialCustom={editingCustom}
        onSave={save}
      />
      <ConversionWizard
        lead={convertLead}
        open={!!convertLead}
        onOpenChange={(v) => !v && setConvertLead(null)}
        onConverted={reload}
      />
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        module="lead"
        moduleLabel="leads"
        onImported={reload}
      />
      {compose && !detailLead && (
        <ComposeEmailDialog
          open={!!compose}
          onOpenChange={(v) => { if (!v) setCompose(null) }}
          to={compose.to}
          relatedModule="lead"
          relatedId={compose.record.id}
          recordName={leadName(compose.record)}
          company={compose.record.company ?? ''}
          ownerName={nameById.get(compose.record.ownerId ?? '')}
          onSent={reload}
        />
      )}
    </>
  )
}
