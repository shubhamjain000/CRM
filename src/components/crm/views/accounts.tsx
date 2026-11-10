'use client'

import * as React from 'react'
import { Trash2, Pencil } from 'lucide-react'
import { CrmTable, StatusBadge, type Column } from '../crm-table'
import { RecordForm, type FieldDef } from '../record-form'
import { DetailView } from '../detail-view'
import { ImportWizard } from '../import-wizard'
import { useCrmList, createRecord, updateRecord, deleteRecord, notify } from '../use-crm-list'
import { useFieldSecurity } from '../use-field-security'
import { useRecordNav } from '@/store/record-nav'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

interface Account {
  id: string; name: string; accountNumber: string | null
  accountType: string; industry: string | null
  annualRevenue: number | null; employees: number | null; website: string | null
  rating: string | null; ownership: string | null; tickerSymbol: string | null
  sicCode: string | null; parentAccountId: string | null; createdAt: string
  pocContactId: string | null
}

interface AccountLite { id: string; name: string }

interface ContactLite { id: string; firstName: string; lastName: string; phones: string }

const TYPE_MAP: Record<string, { label: string; class: string }> = {
  customer: { label: 'Customer', class: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400' },
  prospect: { label: 'Prospect', class: 'border-sky-500/40 text-sky-600 dark:text-sky-400' },
  partner: { label: 'Partner', class: 'border-purple-500/40 text-purple-600 dark:text-purple-400' },
  vendor: { label: 'Vendor', class: 'border-amber-500/40 text-amber-600 dark:text-amber-400' },
  competitor: { label: 'Competitor', class: 'border-destructive/40 text-destructive' },
}

const OWNERSHIP = ['Public', 'Private', 'Subsidiary', 'Government', 'Other']
const RATINGS = ['hot', 'warm', 'cold']

const EMPTY_FILTERS = { accountType: '', industry: '' }

export function AccountsView() {
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<Record<string, string>>({ ...EMPTY_FILTERS })
  const [sort, setSort] = React.useState('-createdAt')
  const [formOpen, setFormOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Account | null>(null)
  const [editingCustom, setEditingCustom] = React.useState<Record<string, unknown> | null>(null)
  const [detail, setDetail] = React.useState<Account | null>(null)
  const { data, loading, reload, loadMore, loadingMore } = useCrmList<Account>('/api/crm/accounts', { search, filters, sort })
  const { data: allData, reload: reloadAccounts } = useCrmList<AccountLite>('/api/crm/accounts', { limit: 200 })
  // Field security (Tier 3): drop columns hidden for the caller's role.
  const { hiddenFor } = useFieldSecurity()
  // Contacts feed the Point-of-Contact (POC) picker — “like contact owner, but a person at the account”.
  const { data: contactsData } = useCrmList<ContactLite>('/api/crm/contacts', { limit: 200 })

  const allAccounts = allData?.items ?? []
  const allContacts = contactsData?.items ?? []

  const contactById = React.useMemo(() => {
    const map = new Map<string, ContactLite>()
    for (const c of allContacts) map.set(c.id, c)
    return map
  }, [allContacts])

  const firstContactPhone = React.useCallback((phonesJson: string): string => {
    try {
      const parsed = JSON.parse(phonesJson || '[]')
      if (Array.isArray(parsed)) {
        const hit = parsed.find((p) => typeof p === 'string' && p.trim())
        return hit ? (hit as string).trim() : ''
      }
    } catch { /* malformed */ }
    return ''
  }, [])

  const industries = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of data?.items ?? []) if (r.industry) set.add(r.industry)
    return [...set].sort()
  }, [data])

  const columns: Column<Account>[] = [
    {
      key: 'name', header: 'Account', sortable: true, sortField: 'name',
      printValue: (r) => r.name,
      render: (r) => (
        <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.industry ?? '—'}</p></div>
      ),
    },
    {
      key: 'accountType', header: 'Type', sortable: true, sortField: 'accountType',
      printValue: (r) => r.accountType,
      render: (r) => <StatusBadge status={r.accountType} map={TYPE_MAP} />,
    },
    {
      key: 'annualRevenue', header: 'Revenue', sortable: true, sortField: 'annualRevenue',
      printValue: (r) => (r.annualRevenue ? `$${r.annualRevenue.toLocaleString()}` : ''),
      render: (r) => r.annualRevenue ? `$${(r.annualRevenue / 1000).toFixed(0)}K` : '—',
    },
    {
      key: 'employees', header: 'Employees', sortable: true, sortField: 'employees',
      printValue: (r) => (r.employees ? String(r.employees) : ''),
      render: (r) => r.employees?.toLocaleString() ?? '—',
    },
    { key: 'website', header: 'Website', render: (r) => r.website ? <span className="text-xs text-muted-foreground">{r.website}</span> : '—' },
    { key: 'rating', header: 'Rating', render: (r) => r.rating ? <span className="capitalize">{r.rating}</span> : '—' },
    {
      key: 'pocContactId', header: 'POC',
      printValue: (r) => (r.pocContactId ? `${contactById.get(r.pocContactId)?.firstName ?? ''} ${contactById.get(r.pocContactId)?.lastName ?? ''}`.trim() : ''),
      render: (r) => {
        if (!r.pocContactId) return <span className="text-xs text-muted-foreground">—</span>
        const poc = contactById.get(r.pocContactId)
        return <span className="text-xs">{poc ? `${poc.firstName} ${poc.lastName}`.trim() : '—'}</span>
      },
    },
    {
      key: 'createdAt', header: 'Created', sortable: true, sortField: 'createdAt',
      printValue: (r) => new Date(r.createdAt).toLocaleDateString(),
      render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</span>,
    },
  ]

  // Field security: hide columns whose catalog key is hidden for the caller's role.
  const hiddenAccount = hiddenFor('account')
  const ACCOUNT_COLUMN_SECURITY_KEYS: Record<string, string[]> = {
    name: ['name'],
    accountType: ['accountType'],
    annualRevenue: ['annualRevenue'],
    employees: ['employees'],
    website: ['website'],
    rating: ['rating'],
  }
  const visibleColumns: Column<Account>[] = columns.filter((c) => {
    const keys = ACCOUNT_COLUMN_SECURITY_KEYS[c.key]
    return !keys || keys.length === 0 || !keys.every((k) => hiddenAccount.has(k))
  })

  const openNew = () => { setEditing(null); setEditingCustom(null); setFormOpen(true) }

  const openEdit = async (r: Account) => {
    setEditing(r)
    setEditingCustom(null)
    setFormOpen(true)
    try {
      const res = await fetch(`/api/crm/accounts/${r.id}`, { cache: 'no-store' })
      if (res.ok) {
        const full = await res.json()
        if (full?.customFields && Object.keys(full.customFields).length > 0) {
          setEditingCustom(full.customFields)
        }
      }
    } catch { /* form still opens without custom prefill */ }
  }

  const save = async (vals: Record<string, unknown>) => {
    if (editing) { await updateRecord('/api/crm/accounts', editing.id, vals); toast.success('Account updated') }
    else { await createRecord('/api/crm/accounts', vals); toast.success('Account created') }
    reload()
  }

  // Inline numeric fields need numeric coercion (API stores Float/Int columns)
  const onDetailFieldEdit = async (account: Account, field: string, value: string) => {
    const payload: Record<string, unknown> =
      field === 'annualRevenue' || field === 'employees'
        ? { [field]: value === '' ? null : Number(value) }
        : { [field]: value }
    await updateRecord('/api/crm/accounts', account.id, payload)
    reload()
  }

  const initial = editing ? {
    name: editing.name,
    accountNumber: editing.accountNumber ?? '',
    accountType: editing.accountType,
    industry: editing.industry ?? '',
    parentAccountId: editing.parentAccountId ?? '',
    pocContactId: editing.pocContactId ?? '',
    ownership: editing.ownership ?? '',
    tickerSymbol: editing.tickerSymbol ?? '',
    sicCode: editing.sicCode ?? '',
    website: editing.website ?? '',
    annualRevenue: editing.annualRevenue ?? '',
    employees: editing.employees ?? '',
    rating: editing.rating ?? '',
  } : { accountType: 'prospect' }

  // Big sectioned form — Zoho-style (columns validated against the Account model)
  const FIELDS: FieldDef[] = [
    // Account Information
    { key: 'name', label: 'Account name', type: 'text', required: true, section: 'Account Information' },
    { key: 'accountNumber', label: 'Account number', type: 'text', section: 'Account Information' },
    { key: 'accountType', label: 'Account type', type: 'select', section: 'Account Information',
      options: Object.entries(TYPE_MAP).map(([value, m]) => ({ value, label: m.label })) },
    { key: 'industry', label: 'Industry', type: 'text', section: 'Account Information' },
    { key: 'parentAccountId', label: 'Parent account', type: 'select', clearable: true, section: 'Account Information',
      options: allAccounts.filter((a) => a.id !== editing?.id).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'pocContactId', label: 'Point of Contact (POC)', type: 'select', clearable: true, section: 'Account Information',
      options: allContacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}`.trim() })) },
    { key: 'ownership', label: 'Ownership', type: 'select', clearable: true, section: 'Account Information',
      options: OWNERSHIP.map((o) => ({ value: o, label: o })) },
    { key: 'tickerSymbol', label: 'Ticker symbol', type: 'text', section: 'Account Information' },
    { key: 'sicCode', label: 'SIC code', type: 'text', section: 'Account Information' },
    // Financial Details
    { key: 'annualRevenue', label: 'Annual revenue', type: 'currency', section: 'Financial Details', placeholder: '0.00' },
    { key: 'employees', label: 'Employees', type: 'number', section: 'Financial Details' },
    { key: 'rating', label: 'Rating', type: 'select', clearable: true, section: 'Financial Details',
      options: RATINGS.map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) })) },
    // Web Information
    { key: 'website', label: 'Website', type: 'url', section: 'Web Information' },
  ]

  const filtersActive = Object.values(filters).filter(Boolean).length
  const clearFilters = () => setFilters({ ...EMPTY_FILTERS })

  /** Open an account by id — powers the Previous / Next arrows and global search deep-links. */
  const openAccountById = React.useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/crm/accounts/${id}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const full = await res.json()
      if (!full?.id) throw new Error()
      setDetail(full)
    } catch {
      toast.error('Could not open that account')
    }
  }, [])

  // Jump straight into a record when requested from the global search palette.
  React.useEffect(() => {
    const hit = useRecordNav.getState().consumeRecord('account')
    if (hit) void openAccountById(hit.id)
  }, [openAccountById])

  // Notification deep-link: 'unstop:navigate' stashes the record id here before
  // switching views — open it once, then clear the key.
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem('unstop:open-record')
      if (!raw) return
      const hit = JSON.parse(raw) as { module?: string; id?: string }
      if (hit.module === 'account' && hit.id) {
        sessionStorage.removeItem('unstop:open-record')
        void openAccountById(hit.id)
      }
    } catch { /* malformed key — ignore */ }
  }, [openAccountById])

  if (detail) {
    return (
      <DetailView
        module="account"
        recordId={detail.id}
        recordName={detail.name}
        onBack={() => setDetail(null)}
        onEdit={() => { setDetail(null); openEdit(detail) }}
        onNavigateRecord={(id) => { void openAccountById(id) }}
        onFieldEdit={async (field, value) => { await onDetailFieldEdit(detail, field, value) }}
        fields={[
          { key: 'name', label: 'Account name', value: detail.name, editable: true },
          { key: 'accountNumber', label: 'Account number', value: detail.accountNumber ?? '', editable: true },
          { key: 'accountType', label: 'Account type', value: TYPE_MAP[detail.accountType]?.label ?? detail.accountType },
          { key: 'industry', label: 'Industry', value: detail.industry ?? '', editable: true },
          { key: 'ownership', label: 'Ownership', value: detail.ownership ?? '', editable: true },
          { key: 'tickerSymbol', label: 'Ticker symbol', value: detail.tickerSymbol ?? '', editable: true },
          { key: 'sicCode', label: 'SIC code', value: detail.sicCode ?? '', editable: true },
          { key: 'website', label: 'Website', value: detail.website ?? '', editable: true },
          { key: 'annualRevenue', label: 'Annual revenue', value: detail.annualRevenue ? `$${detail.annualRevenue.toLocaleString()}` : '', editable: true },
          { key: 'employees', label: 'Employees', value: detail.employees?.toLocaleString() ?? '', editable: true },
          { key: 'rating', label: 'Rating', value: detail.rating ?? '', editable: true },
          { key: 'parent', label: 'Parent account', value: detail.parentAccountId ? allAccounts.find((a) => a.id === detail.parentAccountId)?.name ?? '—' : '—' },
          ...(() => {
            const poc = detail.pocContactId ? contactById.get(detail.pocContactId) : undefined
            const pocName = poc ? `${poc.firstName} ${poc.lastName}`.trim() : ''
            const pocPhone = poc ? firstContactPhone(poc.phones) : ''
            return [
              { key: 'poc', label: 'Point of Contact (POC)', value: pocName || '—' },
              ...(pocPhone ? [{ key: 'pocPhone', label: 'POC phone — tap to call', value: pocPhone, phoneName: pocName || detail.name }] : []),
            ]
          })(),
        ]}
      />
    )
  }

  return (
    <>
      <CrmTable
        title="Accounts"
        endpoint="/api/crm/accounts"
        columns={visibleColumns}
        search={search}
        onSearchChange={setSearch}
        onAdd={openNew}
        onRowClick={(r) => setDetail(r)}
        items={data?.items ?? null}
        loading={loading}
        total={data?.total}
        onReload={reload}
        sort={sort}
        onSortChange={setSort}
        hasMore={!!data?.nextCursor}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        onImport={() => setImportOpen(true)}
        exportModule="account"
        exportQuery={{ ...filters }}
        filterBar={(
          <>
            <Select value={filters.accountType || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, accountType: v === 'all' ? '' : v }))}>
              <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter by type">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(TYPE_MAP).map(([value, meta]) => (
                  <SelectItem key={value} value={value}>{meta.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.industry || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, industry: v === 'all' ? '' : v }))}>
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="Filter by industry">
                <SelectValue placeholder="Industry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All industries</SelectItem>
                {industries.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        )}
        filtersActiveCount={filtersActive}
        activeFilters={[
          ...(filters.accountType
            ? [{ key: 'accountType', label: `Type: ${TYPE_MAP[filters.accountType]?.label ?? filters.accountType}`, onRemove: () => setFilters((f) => ({ ...f, accountType: '' })) }]
            : []),
          ...(filters.industry
            ? [{ key: 'industry', label: `Industry: ${filters.industry}`, onRemove: () => setFilters((f) => ({ ...f, industry: '' })) }]
            : []),
        ]}
        onClearFilters={clearFilters}
        emptyMessage="No accounts yet. Add one manually or import a file."
        rowActions={(r) => (
          <>
            <DropdownMenuItem onClick={() => openEdit(r)}><Pencil className="mr-2 size-4" /> Edit</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => notify(deleteRecord('/api/crm/accounts', r.id), { success: 'Moved to trash' }).then(reload)}>
              <Trash2 className="mr-2 size-4" /> Move to trash
            </DropdownMenuItem>
          </>
        )}
      />
      <RecordForm
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) reloadAccounts() }}
        title={editing ? 'Edit account' : 'New account'}
        description={editing ? 'Update account information, financials and custom fields.' : 'Fill in the account information. Fields marked * are required.'}
        fields={FIELDS}
        initial={initial}
        module="account"
        initialCustom={editingCustom}
        onSave={save}
      />
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        module="account"
        moduleLabel="accounts"
        onImported={reload}
      />
    </>
  )
}
