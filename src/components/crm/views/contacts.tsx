'use client'

import * as React from 'react'
import { Trash2, Pencil, CalendarClock, Mail, MessageCircle, UserCog } from 'lucide-react'
import { CrmTable, type Column } from '../crm-table'
import { RecordForm, type FieldDef } from '../record-form'
import { DetailView, type DetailSection } from '../detail-view'
import { ImportWizard } from '../import-wizard'
import { ListingHistoryTable } from '../listing-history-table'
import { CsmCadenceCard, CsmStepCell } from '../csm-ui'
import { PhonesCell } from '../call-dialer'
import { useCrmList, createRecord, updateRecord, deleteRecord, notify } from '../use-crm-list'
import { useFieldSecurity } from '../use-field-security'
import { FilterBuilder, condsToParams, describeConds, type FilterCond, type FilterFieldDef } from '../filter-builder'
import { useRecordNav } from '@/store/record-nav'
import { safeJsonParse } from '@/components/safe-json'
import { OwnerCell, useOrgMembers, firstPhone, buildWhatsappUrl, logOutreach } from '../owner'
import { ComposeEmailDialog } from '../compose-email-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { CSM_STEPS, CSM_TONE_CLASSES, csmStepMeta } from '@/lib/csm'
import { toast } from 'sonner'

interface Contact {
  id: string; firstName: string; lastName: string; title: string | null
  department: string | null; leadSource: string | null
  accountId: string | null; emails: string; phones: string; description: string | null
  birthday?: string | null; assistant?: string | null
  doNotCall?: boolean; emailOptOut?: boolean
  csmNextStep: string | null; csmNextStepAt: string | null; csmNextStepDueAt: string | null
  createdAt: string; updatedAt: string
  ownerId?: string
  // Listing Intelligence (additive, optional)
  recruiterTag?: string | null; premiumStatus?: string | null; listingSubtype?: string | null
  totalApplications?: number | null; reasonableFitPct?: number | null; reasonableScoreUsers?: number | null
  listingUrl?: string | null; listingTitle?: string | null; listingCategory?: string | null
  dateApproved?: string | null; csmRecruiterType?: string | null; csmStatus?: string | null
  csmNextCallDate?: string | null; totalReachoutsDone?: number | null; lastReachedOutAt?: string | null
  // Latest-listing mirrors (same columns as the Listings board)
  visibility?: string | null; hiringStatus?: string | null
  relevantApplications?: number | null; hiredCount?: number | null
  // Zoho Recruiter Information form (additive sections)
  typeOfLead?: string | null; recruiterTriggers?: string | null; company?: string | null
  employeeRange?: string | null; linkedinUrl?: string | null; totalOps?: number | null
  modifiedById?: string | null; reachoutTat?: string | null
  firstConversationAt?: string | null; totalConversationsHad?: number | null
  hiringRoles?: string | null; joiningTimeline?: string | null; otherPlatformUsed?: string | null
  recruiterFeedback?: string | null; paidPlanPitch?: string | null; livePremiumOps?: number | null
  postPitchLeadType?: string | null; paidPlanPitchDate?: string | null
  paidPlanFeedback?: string | null; paidPlanExpiryDate?: string | null
  addRecruiterName?: string | null; addRecruiterDesignation?: string | null
  addRecruiterMobile?: string | null
  // Listing history (attached by the detail API for contacts)
  listings?: ContactListingLite[]
}

/** One listing-history entry (ContactListing) shown on the contact detail view. */
interface ContactListingLite {
  id: string; url: string | null; title: string | null; subtype: string | null
  category: string | null; recruiterTag: string | null; premiumStatus: string | null
  visibility?: string | null; hiringStatus?: string | null
  totalApplications?: number | null; reasonableFitPct?: number | null
  relevantApplications?: number | null; hiredCount?: number | null
  dateApproved?: string | null; firstImportedAt: string; lastImportedAt: string; source: string
  createdAt?: string
}

interface AccountLite { id: string; name: string }

const LEAD_SOURCES = [
  'Advertisement', 'Cold Call', 'Employee Referral', 'External Referral',
  'Online Store', 'Partner', 'Public Relations', 'Seminar Partner',
  'Trade Show', 'Web Download', 'Web Research', 'Chat',
]

// ---- Listing Intelligence picklists (shared by the form + detail sections) ----
const RECRUITER_TAGS = ['New Recruiter', 'Existing Recruiter']
const PREMIUM_STATUSES = ['Free', 'Paid']
const LISTING_SUBTYPES = ['Jobs', 'Internships']
const CSM_RECRUITER_TYPES = ['First Time', 'Existing', 'New']
const LISTING_CATEGORIES = [
  'All', 'Fresher', 'Experienced Professionals', 'Undergraduate', 'Postgraduate',
  'Engineering Students', 'Management', 'Arts Commerce Sciences & Others', 'Law', 'Medical',
]

// ---- Zoho "Recruiter Information" picklists ----
const TYPE_OF_LEAD_OPTIONS = ['CSM', 'Organic', 'Inbound', 'Outbound', 'Other']
const EMPLOYEE_RANGES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']
const JOINING_TIMELINES = ['Immediate', 'Within 15 days', 'Within 30 days', '1-2 months', '3+ months', 'Not urgent']
const POST_PITCH_LEAD_TYPES = ['Hot', 'Warm', 'Cold', 'Not Interested']

/** Listing Intelligence fields the form owns — empty values are saved as null. */
const LISTING_NULLABLE_FIELDS = [
  'recruiterTag', 'premiumStatus', 'listingSubtype', 'csmRecruiterType', 'csmStatus',
  'reasonableFitPct', 'totalApplications', 'reasonableScoreUsers',
  'listingUrl', 'listingTitle', 'csmNextCallDate', 'dateApproved',
  // Zoho Recruiter Information form (additive)
  'typeOfLead', 'recruiterTriggers', 'company', 'employeeRange', 'linkedinUrl',
  'reachoutTat', 'hiringRoles', 'joiningTimeline', 'otherPlatformUsed',
  'recruiterFeedback', 'paidPlanPitch', 'postPitchLeadType', 'paidPlanFeedback',
  'addRecruiterName', 'addRecruiterDesignation', 'addRecruiterMobile',
  'lastReachedOutAt', 'firstConversationAt', 'paidPlanPitchDate', 'paidPlanExpiryDate',
  'totalOps', 'totalConversationsHad', 'livePremiumOps',
]

const opts = (values: string[]) => values.map((v) => ({ value: v, label: v }))

/** Zoho-style filterable fields for the contacts advanced filter builder. */
const CONTACT_FILTER_FIELDS: FilterFieldDef[] = [
  { key: 'csmStatus', label: 'CSM status', type: 'text' },
  { key: 'csmRecruiterType', label: 'CSM recruiter type', type: 'select', options: opts(CSM_RECRUITER_TYPES) },
  { key: 'recruiterTag', label: 'Recruiter tag', type: 'select', options: opts(RECRUITER_TAGS) },
  { key: 'premiumStatus', label: 'Premium status', type: 'select', options: opts(PREMIUM_STATUSES) },
  { key: 'listingSubtype', label: 'Listing subtype', type: 'select', options: opts(LISTING_SUBTYPES) },
  { key: 'department', label: 'Department', type: 'text' },
  { key: 'reasonableFitPct', label: 'Reasonable fit %', type: 'number' },
  { key: 'totalApplications', label: 'Total applications', type: 'number' },
  { key: 'totalReachoutsDone', label: 'Total reachouts done', type: 'number' },
  { key: 'doNotCall', label: 'Do not call', type: 'boolean' },
  { key: 'emailOptOut', label: 'Email opt out', type: 'boolean' },
  { key: 'createdAt', label: 'Created', type: 'date' },
  { key: 'csmNextStepDueAt', label: 'Follow-up due', type: 'date' },
  { key: 'lastReachedOutAt', label: 'Last reached out', type: 'date' },
]

/** Recruiter tag pill — New Recruiter = sky, Existing Recruiter = teal. */
function RecruiterTagPill({ tag }: { tag: string | null | undefined }) {
  if (!tag) return <span className="text-xs text-muted-foreground">—</span>
  const lower = tag.toLowerCase()
  const cls = lower === 'new recruiter'
    ? 'bg-sky-100 text-sky-700'
    : lower === 'existing recruiter'
      ? 'bg-teal-100 text-teal-700'
      : 'bg-muted text-muted-foreground'
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{tag}</span>
}

/** Premium pill — Free = grey, Paid = gold. */
function PremiumPill({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>
  const paid = status.toLowerCase() === 'paid'
  const cls = paid ? 'border border-amber-300 bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>
}

/** Reasonable Fit % badge — 0-25 red / 26-50 yellow / 51-75 orange / 76-100 green. */
function FitPctBadge({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const v = Math.round(pct)
  const cls = v <= 25
    ? 'bg-red-100 text-red-700'
    : v <= 50
      ? 'bg-yellow-100 text-yellow-700'
      : v <= 75
        ? 'bg-orange-100 text-orange-700'
        : 'bg-emerald-100 text-emerald-700'
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{v}%</span>
}

/** Truncated, fully clickable listing link (display truncates, href stays complete). */
function ListingLink({ url }: { url: string | null | undefined }) {
  if (!url) return <span className="text-muted-foreground">—</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className="inline-block max-w-full truncate align-bottom text-primary underline underline-offset-2 hover:opacity-80"
    >
      {url}
    </a>
  )
}

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

const dash = <span className="text-muted-foreground">—</span>
const fmtDate = (v: string | null | undefined) =>
  v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toLocaleDateString() : null
const fmtDateTime = (v: string | null | undefined) =>
  v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toLocaleString() : null

/** The additive "Listing Intelligence" card passed to DetailView (contacts only). */
function listingSections(c: Contact): DetailSection[] {
  const cats = safeJsonParse<string[]>(c.listingCategory ?? '', [])
  const sections: DetailSection[] = [{
    title: 'Listing Intelligence',
    fields: [
      { key: 'recruiterTag', label: 'Recruiter tag', node: <RecruiterTagPill tag={c.recruiterTag} /> },
      { key: 'premiumStatus', label: 'Premium', node: <PremiumPill status={c.premiumStatus} /> },
      { key: 'reasonableFitPct', label: 'Reasonable fit', node: <FitPctBadge pct={c.reasonableFitPct} /> },
      { key: 'listingUrl', label: 'Listing URL', node: <ListingLink url={c.listingUrl} /> },
      { key: 'listingTitle', label: 'Listing title', node: c.listingTitle || dash },
      { key: 'listingSubtype', label: 'Listing subtype', node: c.listingSubtype || dash },
      { key: 'listingCategory', label: 'Listing category', node: cats.length > 0 ? cats.join(', ') : dash },
      { key: 'totalApplications', label: 'Total applications', node: c.totalApplications ?? dash },
      { key: 'reasonableScoreUsers', label: 'Reasonable score users', node: c.reasonableScoreUsers ?? dash },
      { key: 'dateApproved', label: 'Date approved', node: fmtDate(c.dateApproved) ?? dash },
      { key: 'csmRecruiterType', label: 'CSM recruiter type', node: c.csmRecruiterType || dash },
      { key: 'csmStatus', label: 'CSM status', node: c.csmStatus || dash },
      { key: 'csmNextCallDate', label: 'CSM next call date', node: fmtDate(c.csmNextCallDate) ?? dash },
      { key: 'totalReachoutsDone', label: 'Total reachouts done', node: c.totalReachoutsDone ?? dash },
      { key: 'lastReachedOutAt', label: 'Last reached-out time', node: fmtDateTime(c.lastReachedOutAt) ?? dash },
    ],
  }]
  // Listing history — every listing imported for this recruiter over time,
  // laid out in the same Zoho-style organized column bar as the Listings board
  // (Listing Title · Date Approved · Applications · Listing URL · Listing Type ·
  //  Visibility · Hired Count · Hiring Status · Created Time ·
  //  Relevant Applications (34% match & above) · Category).
  // Newest first; the record's own listing* fields above mirror the latest.
  if (c.listings && c.listings.length > 0) {
    sections.push({
      title: `Listing history (${c.listings.length})`,
      fields: [],
      node: <ListingHistoryTable listings={c.listings} />,
    })
  }
  return sections
}

/** Zoho "Recruiter Information" detail sections — Form Details, Reachout TAT &
 *  CSM Status, Paid Plan Pitch & Details, Additional Recruiter Details —
 *  followed by the existing Listing Intelligence card + listing history. */
function recruiterSections(c: Contact, nameById: Map<string, string>): DetailSection[] {
  const txt = (v: string | number | null | undefined) =>
    v === null || v === undefined || v === ''
      ? dash
      : <span className="whitespace-pre-wrap break-words">{String(v)}</span>
  return [
    {
      title: 'Form Details',
      fields: [
        { key: 'company', label: 'Company', node: txt(c.company) },
        { key: 'employeeRange', label: 'Employee Range', node: txt(c.employeeRange) },
        { key: 'linkedinUrl', label: 'LinkedIn URL', node: c.linkedinUrl ? <ListingLink url={c.linkedinUrl} /> : dash },
        { key: 'totalOps', label: 'Total Ops', node: txt(c.totalOps) },
        { key: 'layout', label: 'Layout', node: 'Basic' },
        { key: 'modifiedBy', label: 'Modified By', node: nameById.get(c.modifiedById ?? '') ?? dash },
      ],
    },
    {
      title: 'Reachout TAT & CSM Status',
      fields: [
        { key: 'csmStatus', label: 'CSM Status', node: txt(c.csmStatus) },
        { key: 'csmRecruiterType', label: 'CSM Recruiter Type', node: txt(c.csmRecruiterType) },
        { key: 'totalReachoutsDone', label: 'Total Reachouts Done', node: txt(c.totalReachoutsDone) },
        { key: 'reachoutTat', label: 'Reachout TAT', node: txt(c.reachoutTat) },
        { key: 'csmNextStep', label: 'CSM Next Step', node: txt(c.csmNextStep || 'None') },
        { key: 'firstConversationAt', label: 'First Conversation Call', node: fmtDate(c.firstConversationAt) ?? dash },
        { key: 'totalConversationsHad', label: 'Total Conversations Had', node: txt(c.totalConversationsHad) },
        { key: 'hiringRoles', label: 'How many & for what roles are you hiring?', node: txt(c.hiringRoles) },
        { key: 'dateApproved', label: 'Last Listing Date', node: fmtDate(c.dateApproved) ?? dash },
        { key: 'lastReachedOutAt', label: 'Last Reached-Out Time', node: fmtDateTime(c.lastReachedOutAt) ?? dash },
        { key: 'csmNextCallDate', label: 'CSM Next Call Date', node: fmtDate(c.csmNextCallDate) ?? dash },
        { key: 'joiningTimeline', label: 'How soon you want the candidate to join?', node: txt(c.joiningTimeline) },
        { key: 'otherPlatformUsed', label: 'Have you used any other platform?', node: txt(c.otherPlatformUsed) },
        { key: 'recruiterFeedback', label: 'Recruiter Feedback', node: txt(c.recruiterFeedback) },
      ],
    },
    {
      title: 'Paid Plan Pitch & Details',
      fields: [
        { key: 'paidPlanPitch', label: 'Paid Plan Pitch', node: txt(c.paidPlanPitch) },
        { key: 'premiumStatus', label: 'Paid Plan Purchased', node: <PremiumPill status={c.premiumStatus} /> },
        { key: 'livePremiumOps', label: 'No. of Live Premium Ops', node: txt(c.livePremiumOps) },
        { key: 'postPitchLeadType', label: 'Post Pitch Lead type', node: txt(c.postPitchLeadType) },
        { key: 'paidPlanPitchDate', label: 'Date of Paid Plan Pitch', node: fmtDate(c.paidPlanPitchDate) ?? dash },
        { key: 'paidPlanFeedback', label: 'Paid Recruiter Subjective Feedback', node: txt(c.paidPlanFeedback) },
        { key: 'paidPlanExpiryDate', label: 'Paid Plan Expiry Date', node: fmtDate(c.paidPlanExpiryDate) ?? dash },
      ],
    },
    {
      title: 'Additional Recruiter Details',
      fields: [
        { key: 'addRecruiterName', label: 'Name (Add)', node: txt(c.addRecruiterName) },
        { key: 'addRecruiterDesignation', label: 'Designation', node: txt(c.addRecruiterDesignation) },
        { key: 'addRecruiterMobile', label: 'Mobile Number (Add)', node: txt(c.addRecruiterMobile) },
      ],
    },
    ...listingSections(c),
  ]
}

const EMPTY_FILTERS = { leadSource: '', accountId: '', csmNextStep: '', ownerId: '' }

function iso(d: Date) { return d.toISOString() }

function dayBounds(base = new Date()) {
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999)
  return { start, end }
}

export function ContactsView() {
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<Record<string, string>>({ ...EMPTY_FILTERS })
  const [dueFilter, setDueFilter] = React.useState('')
  const [filterConds, setFilterConds] = React.useState<FilterCond[]>([])
  const [savedViews, setSavedViews] = React.useState<{ id: string; name: string; isDefault: boolean; isShared?: boolean; config: Record<string, unknown> }[]>([])
  const [sort, setSort] = React.useState('-createdAt')
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Contact | null>(null)
  const [editingCustom, setEditingCustom] = React.useState<Record<string, unknown> | null>(null)
  const [detail, setDetail] = React.useState<Contact | null>(null)
  const [importOpen, setImportOpen] = React.useState(false)
  const [accounts, setAccounts] = React.useState<AccountLite[]>([])

  // Merge the plain filters with the derived "follow-up due" range filter.
  const queryFilters = React.useMemo(() => {
    const qf: Record<string, string> = { ...filters }
    delete qf.csmNextStepDueAt_gte
    delete qf.csmNextStepDueAt_lte
    const { start, end } = dayBounds()
    if (dueFilter === 'overdue') {
      qf.csmNextStepDueAt_lte = iso(new Date(start.getTime() - 1))
    } else if (dueFilter === 'today') {
      qf.csmNextStepDueAt_gte = iso(start)
      qf.csmNextStepDueAt_lte = iso(end)
    } else if (dueFilter === 'week') {
      const weekEnd = dayBounds(new Date(start.getTime() + 7 * 86_400_000)).end
      qf.csmNextStepDueAt_gte = iso(start)
      qf.csmNextStepDueAt_lte = iso(weekEnd)
    }
    return qf
  }, [filters, dueFilter])

  const filterParams = React.useMemo(() => condsToParams(filterConds), [filterConds])
  const listFilters = React.useMemo(() => ({ ...queryFilters, ...filterParams }), [queryFilters, filterParams])

  const { data, loading, reload, loadMore, loadingMore } = useCrmList<Contact>('/api/crm/contacts', { search, filters: listFilters, sort })
  const { data: accountData, reload: reloadAccounts } = useCrmList<AccountLite>('/api/crm/accounts', { limit: 200 })
  const { members, nameById } = useOrgMembers()
  // Field security (Tier 3): drop columns hidden for the caller's role.
  const { hiddenFor } = useFieldSecurity()
  const [compose, setCompose] = React.useState<{ to: string; record: Contact } | null>(null)

  const contactName = (r: Contact) => [r.firstName, r.lastName].filter(Boolean).join(' ') || 'this contact'

  React.useEffect(() => {
    if (accountData?.items) setAccounts(accountData.items)
  }, [accountData])

  const accountName = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const a of accounts) map.set(a.id, a.name)
    return map
  }, [accounts])

  const sources = React.useMemo(() => {
    const set = new Set<string>(LEAD_SOURCES)
    for (const r of data?.items ?? []) if (r.leadSource) set.add(r.leadSource)
    return [...set].sort()
  }, [data])

  // Zoho-style organized bar — every option in its own fixed-width column
  // (px-1.5! overrides the default cell padding so each width holds its
  // content), table-fixed grid + columnDividers for clean vertical rules.
  // Core contact columns come first, then the Listings board columns
  // (Listing Title → Relevant Applications), then Created Time.
  const columns: Column<Contact>[] = [
    {
      key: 'name', header: 'Contact Name', sortable: true, sortField: 'firstName',
      className: 'w-44 px-1.5!',
      printValue: (r) => `${r.firstName} ${r.lastName}`,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium" title={`${r.firstName} ${r.lastName}`}>{r.firstName} {r.lastName}</p>
          <p className="truncate text-xs text-muted-foreground" title={r.title ?? undefined}>{r.title ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'email', header: 'Email', className: 'w-44 px-1.5!',
      printValue: (r) => safeJsonParse<string[]>(r.emails, [])[0] ?? '',
      render: (r) => {
        const emails = safeJsonParse<string[]>(r.emails, [])
        return emails[0]
          ? <span className="block truncate" title={emails[0]}>{emails[0]}</span>
          : '—'
      },
    },
    {
      key: 'phone', header: 'Phone', className: 'w-36 px-1.5!',
      printValue: (r) => safeJsonParse<string[]>(r.phones, [])[0] ?? '',
      render: (r) => (
        <PhonesCell
          phonesJson={r.phones}
          name={`${r.firstName} ${r.lastName}`.trim()}
          module="contact"
          recordId={r.id}
        />
      ),
    },
    {
      key: 'owner', header: 'Owner', className: 'w-32 px-1.5!',
      printValue: (r) => nameById.get(r.ownerId ?? '') ?? '',
      render: (r) => <OwnerCell ownerId={r.ownerId} nameById={nameById} />,
    },
    {
      key: 'accountId', header: 'Account', sortField: 'accountId', sortable: true, className: 'w-36 px-1.5!',
      printValue: (r) => (r.accountId ? accountName.get(r.accountId) ?? '' : ''),
      render: (r) => r.accountId
        ? <span className="block truncate" title={accountName.get(r.accountId) ?? undefined}>{accountName.get(r.accountId) ?? <span className="font-mono text-xs">{r.accountId.slice(-8)}</span>}</span>
        : '—',
    },
    { key: 'department', header: 'Department', className: 'w-32 px-1.5!', printValue: (r) => r.department ?? '', render: (r) => r.department
        ? <span className="block truncate" title={r.department}>{r.department}</span>
        : '—' },
    { key: 'leadSource', header: 'Source', className: 'w-32 px-1.5!', printValue: (r) => r.leadSource ?? '', render: (r) => r.leadSource
        ? <span className="block truncate" title={r.leadSource}>{r.leadSource}</span>
        : '—' },
    {
      key: 'csmNextStep', header: 'Next Step', sortable: true, sortField: 'csmNextStepDueAt',
      className: 'w-36 px-1.5!',
      printValue: (r) => `${r.csmNextStep || 'None'}${r.csmNextStepDueAt ? ` (due ${new Date(r.csmNextStepDueAt).toLocaleDateString()})` : ''}`,
      render: (r) => <CsmStepCell step={r.csmNextStep || 'None'} dueAt={r.csmNextStepDueAt} />,
    },
    // ---- Listing bar (same columns as the Listings board, one per column) ----
    {
      key: 'listingTitle', header: 'Listing Title', className: 'w-56 px-1.5!',
      printValue: (r) => r.listingTitle ?? '',
      render: (r) => r.listingTitle
        ? <span className="line-clamp-2 font-medium" title={r.listingTitle}>{r.listingTitle}</span>
        : dash,
    },
    {
      key: 'dateApproved', header: 'Date Approved', className: 'w-32 whitespace-nowrap px-1.5!',
      printValue: (r) => fmtDate(r.dateApproved) ?? '',
      render: (r) => fmtDate(r.dateApproved) ?? dash,
    },
    {
      key: 'totalApplications', header: 'Applications', sortable: true, sortField: 'totalApplications',
      className: 'w-28 px-1.5! text-right tabular-nums',
      printValue: (r) => (r.totalApplications ?? '').toString(),
      render: (r) => (r.totalApplications ?? null) !== null ? r.totalApplications!.toLocaleString() : dash,
    },
    {
      key: 'listingUrl', header: 'Listing URL', className: 'w-40 px-1.5!',
      printValue: (r) => r.listingUrl ?? '',
      render: (r) => <ListingLink url={r.listingUrl} />,
    },
    {
      key: 'listingSubtype', header: 'Listing Type', className: 'w-32 px-1.5!',
      printValue: (r) => r.listingSubtype ?? '',
      render: (r) => <TypePill type={r.listingSubtype} />,
    },
    {
      key: 'visibility', header: 'Visibility', className: 'w-28 px-1.5!',
      printValue: (r) => r.visibility ?? '',
      render: (r) => <VisibilityPill visibility={r.visibility} />,
    },
    {
      key: 'hiredCount', header: 'Hired Count', sortable: true, sortField: 'hiredCount',
      className: 'w-28 px-1.5! text-right tabular-nums',
      printValue: (r) => (r.hiredCount ?? '').toString(),
      render: (r) => (r.hiredCount ?? null) !== null ? r.hiredCount!.toLocaleString() : dash,
    },
    {
      key: 'hiringStatus', header: 'Hiring Status', className: 'w-36 px-1.5!',
      printValue: (r) => r.hiringStatus ?? '',
      render: (r) => <HiringStatusPill status={r.hiringStatus} />,
    },
    {
      key: 'relevantApplications', header: 'Relevant Applications (34% match & above)', sortable: true, sortField: 'relevantApplications',
      className: 'w-80 px-1.5! text-right tabular-nums',
      printValue: (r) => (r.relevantApplications ?? '').toString(),
      render: (r) => (r.relevantApplications ?? null) !== null ? r.relevantApplications!.toLocaleString() : dash,
    },
    // ---- End listing bar ----
    {
      key: 'createdAt', header: 'Created Time', sortable: true, sortField: 'createdAt',
      className: 'w-32 whitespace-nowrap px-1.5!',
      printValue: (r) => new Date(r.createdAt).toLocaleDateString(),
      render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</span>,
    },
  ]

  // Field security: hide columns whose catalog key is hidden for the caller's
  // role (email→emails, phone→phones, owner→ownerId via the hook's aliases are
  // handled in DetailView; here columns map straight onto catalog keys).
  const hiddenContact = hiddenFor('contact')
  const CONTACT_COLUMN_SECURITY_KEYS: Record<string, string[]> = {
    name: ['firstName', 'lastName'],
    email: ['emails'],
    phone: ['phones'],
    owner: ['ownerId'],
    accountId: ['accountId'],
    department: ['department'],
    leadSource: ['leadSource'],
    // Listing bar columns map 1:1 onto the catalog keys
    listingTitle: ['listingTitle'],
    dateApproved: ['dateApproved'],
    totalApplications: ['totalApplications'],
    listingUrl: ['listingUrl'],
    listingSubtype: ['listingSubtype'],
    visibility: ['visibility'],
    hiredCount: ['hiredCount'],
    hiringStatus: ['hiringStatus'],
    relevantApplications: ['relevantApplications'],
  }
  const visibleColumns: Column<Contact>[] = columns.filter((c) => {
    const keys = CONTACT_COLUMN_SECURITY_KEYS[c.key]
    return !keys || keys.length === 0 || !keys.every((k) => hiddenContact.has(k))
  })

  const openNew = () => { setEditing(null); setEditingCustom(null); setFormOpen(true) }

  /** Open the detail from a row click — the list payload has no listing
   *  history, so the full record (which carries `listings`) is fetched
   *  right after and merged in without losing the snappy first paint. */
  const openDetail = React.useCallback((r: Contact) => {
    setDetail(r)
    fetch(`/api/crm/contacts/${r.id}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((full) => {
        if (full?.id) setDetail((prev) => (prev && prev.id === full.id ? { ...prev, ...full } : prev))
      })
      .catch(() => { /* keep the row-level detail */ })
  }, [])

  // Edit fetches the full record so custom field values prefill
  const openEdit = async (r: Contact) => {
    setEditing(r)
    setEditingCustom(null)
    setFormOpen(true)
    try {
      const res = await fetch(`/api/crm/contacts/${r.id}`, { cache: 'no-store' })
      if (res.ok) {
        const full = await res.json()
        if (full?.customFields && Object.keys(full.customFields).length > 0) {
          setEditingCustom(full.customFields)
        }
      }
    } catch { /* form still opens without custom prefill */ }
  }

  const refreshDetail = React.useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/crm/contacts/${id}`, { cache: 'no-store' })
      if (res.ok) {
        const full = await res.json()
        if (full && full.id) setDetail((prev) => (prev && prev.id === id ? { ...prev, ...full } : prev))
      }
    } catch { /* keep the stale detail rather than closing the view */ }
  }, [])

  /** Reassign a contact to another owner (validated server-side). */
  const changeOwner = async (id: string, ownerId: string) => {
    try {
      await updateRecord('/api/crm/contacts', id, { ownerId })
      toast.success(`Owner updated — ${nameById.get(ownerId) ?? 'new owner'}`)
      reload()
      if (detail?.id === id) await refreshDetail(id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change the owner')
    }
  }

  /** Bulk reassign selected contacts. */
  const bulkAssign = async (ids: string[], ownerId: string, clear: () => void) => {
    try {
      const res = await fetch('/api/crm/contacts/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, data: { ownerId } }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Bulk assign failed')
      toast.success(`${json?.count ?? ids.length} contact${ids.length === 1 ? '' : 's'} assigned to ${nameById.get(ownerId) ?? 'owner'}`)
      clear()
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk assign failed')
    }
  }

  /** Open WhatsApp for the contact's first phone; the visit is logged on the timeline. */
  const openWhatsapp = async (r: Contact) => {
    const phone = firstPhone(r.phones)
    if (!phone) { toast.error('This contact has no phone number'); return }
    const url = buildWhatsappUrl(phone, `Hi ${r.firstName || 'there'}, following up from Unstop — is this a good time to talk?`)
    if (!url) { toast.error(`Could not build a WhatsApp link for ${phone}`); return }
    window.open(url, '_blank', 'noopener')
    await logOutreach({ module: 'contact', recordId: r.id, channel: 'whatsapp', description: `WhatsApp chat opened · ${phone}` })
    toast.info(`WhatsApp opened for ${contactName(r)} · ${phone} — logged on the timeline`)
  }

  /** Open the email composer pre-filled with the contact's first email. */
  const openEmail = (r: Contact) => {
    const to = safeJsonParse<string[]>(r.emails ?? '[]', [])[0] ?? ''
    if (!to) { toast.error('This contact has no email address'); return }
    setCompose({ to, record: r })
  }

  /** Open a contact by id — powers the Previous / Next arrows and global search deep-links. */
  const openContactById = React.useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/crm/contacts/${id}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const full = await res.json()
      if (!full?.id) throw new Error()
      setDetail(full)
    } catch {
      toast.error('Could not open that contact')
    }
  }, [])

  // Jump straight into a record when requested from the global search palette.
  React.useEffect(() => {
    const hit = useRecordNav.getState().consumeRecord('contact')
    if (hit) void openContactById(hit.id)
  }, [openContactById])

  // Notification deep-link: 'unstop:navigate' stashes the record id here before
  // switching views — open it once, then clear the key.
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem('unstop:open-record')
      if (!raw) return
      const hit = JSON.parse(raw) as { module?: string; id?: string }
      if (hit.module === 'contact' && hit.id) {
        sessionStorage.removeItem('unstop:open-record')
        void openContactById(hit.id)
      }
    } catch { /* malformed key — ignore */ }
  }, [openContactById])

  const save = async (vals: Record<string, unknown>) => {
    const email = vals.email ? [String(vals.email)] : []
    const phone = vals.phone ? [String(vals.phone)] : []
    const payload: Record<string, unknown> = { ...vals, emails: JSON.stringify(email), phones: JSON.stringify(phone) }
    delete payload.email; delete payload.phone
    if (!payload.ownerId) delete payload.ownerId

    // Listing Intelligence: the multiselect carries a string[] — store it as a
    // JSON array string (null when nothing is selected). Numeric/date/text
    // empties become null so the optional columns never hold ''/NaN.
    const cats = payload.listingCategory
    payload.listingCategory = Array.isArray(cats)
      ? (cats.length > 0 ? JSON.stringify(cats) : null)
      : (typeof cats === 'string' && cats.trim() !== '' ? cats : null)
    for (const k of LISTING_NULLABLE_FIELDS) {
      if (payload[k] === undefined || payload[k] === '') payload[k] = null
    }

    if (editing) { await updateRecord('/api/crm/contacts', editing.id, payload); toast.success('Contact updated') }
    else { await createRecord('/api/crm/contacts', payload); toast.success('Contact created') }
    reload()
  }

  const onDetailFieldEdit = async (contact: Contact, field: string, value: string) => {
    const payload: Record<string, unknown> =
      field === 'email' ? { emails: JSON.stringify(value ? [value] : []) }
      : field === 'phone' ? { phones: JSON.stringify(value ? [value] : []) }
      : { [field]: value }
    await updateRecord('/api/crm/contacts', contact.id, payload)
    reload()
  }

  /** Quick-set the cadence step from the row menu (server stamps due date + creates the follow-up task). */
  const setStep = async (r: Contact, step: string) => {
    try {
      await updateRecord('/api/crm/contacts', r.id, { csmNextStep: step })
      const meta = csmStepMeta(step)
      toast.success(meta.days === null
        ? `Next step set — ${step}`
        : `Next step set — ${step} · follow-up due ${meta.days === 0 ? 'today' : meta.days === 1 ? 'tomorrow' : `in ${meta.days} days`}`)
      reload()
      if (detail?.id === r.id) await refreshDetail(r.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set the next step')
    }
  }

  const bulkSetStep = async (ids: string[], step: string) => {
    const res = await fetch('/api/crm/contacts/bulk-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, data: { csmNextStep: step } }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error || 'Bulk update failed')
    return json
  }

  const initial = editing ? {
    firstName: editing.firstName, lastName: editing.lastName, title: editing.title ?? '',
    email: safeJsonParse<string[]>(editing.emails, [])[0] ?? '',
    phone: safeJsonParse<string[]>(editing.phones, [])[0] ?? '',
    department: editing.department ?? '', leadSource: editing.leadSource ?? '',
    assistant: editing.assistant ?? '',
    ownerId: editing.ownerId ?? '',
    birthday: editing.birthday ? String(editing.birthday).slice(0, 10) : '',
    accountId: editing.accountId ?? '',
    csmNextStep: editing.csmNextStep || 'None',
    doNotCall: Boolean(editing.doNotCall), emailOptOut: Boolean(editing.emailOptOut),
    description: editing.description ?? '',
    // Listing Intelligence — category stored as JSON array string in the DB,
    // edited as string[] by the multiselect.
    recruiterTag: editing.recruiterTag ?? '',
    premiumStatus: editing.premiumStatus ?? '',
    listingSubtype: editing.listingSubtype ?? '',
    csmRecruiterType: editing.csmRecruiterType ?? '',
    csmStatus: editing.csmStatus ?? '',
    reasonableFitPct: editing.reasonableFitPct ?? '',
    totalApplications: editing.totalApplications ?? '',
    reasonableScoreUsers: editing.reasonableScoreUsers ?? '',
    listingUrl: editing.listingUrl ?? '',
    listingTitle: editing.listingTitle ?? '',
    listingCategory: safeJsonParse<string[]>(editing.listingCategory ?? '[]', []),
    csmNextCallDate: editing.csmNextCallDate ? String(editing.csmNextCallDate).slice(0, 10) : '',
    dateApproved: editing.dateApproved ? String(editing.dateApproved).slice(0, 10) : '',
    // Zoho Recruiter Information sections
    typeOfLead: editing.typeOfLead ?? '',
    recruiterTriggers: editing.recruiterTriggers ?? '',
    company: editing.company ?? '',
    employeeRange: editing.employeeRange ?? '',
    linkedinUrl: editing.linkedinUrl ?? '',
    totalOps: editing.totalOps ?? '',
    reachoutTat: editing.reachoutTat ?? '',
    firstConversationAt: editing.firstConversationAt ? String(editing.firstConversationAt).slice(0, 10) : '',
    totalConversationsHad: editing.totalConversationsHad ?? '',
    hiringRoles: editing.hiringRoles ?? '',
    joiningTimeline: editing.joiningTimeline ?? '',
    otherPlatformUsed: editing.otherPlatformUsed ?? '',
    recruiterFeedback: editing.recruiterFeedback ?? '',
    paidPlanPitch: editing.paidPlanPitch ?? '',
    livePremiumOps: editing.livePremiumOps ?? '',
    postPitchLeadType: editing.postPitchLeadType ?? '',
    paidPlanPitchDate: editing.paidPlanPitchDate ? String(editing.paidPlanPitchDate).slice(0, 10) : '',
    paidPlanFeedback: editing.paidPlanFeedback ?? '',
    paidPlanExpiryDate: editing.paidPlanExpiryDate ? String(editing.paidPlanExpiryDate).slice(0, 10) : '',
    addRecruiterName: editing.addRecruiterName ?? '',
    addRecruiterDesignation: editing.addRecruiterDesignation ?? '',
    addRecruiterMobile: editing.addRecruiterMobile ?? '',
  } : { csmNextStep: 'None', doNotCall: false, emailOptOut: false, ownerId: '', listingCategory: [] }

  // Big sectioned form — mirrors the Zoho "Recruiter Information" layout:
  // Recruiter Information → Contact Information → Form Details →
  // Reachout TAT & CSM Status → Paid Plan Pitch & Details →
  // Additional Recruiter Details → Preferences → Description → Listing Intelligence.
  // Admins/members can extend it with the Custom Fields section at the bottom.
  const FIELDS: FieldDef[] = [
    // Recruiter Information (Contact Owner · Contact Name · Email · Account Name · Type of Lead · Recruiter Triggers)
    { key: 'ownerId', label: 'Contact Owner', type: 'select', clearable: true, section: 'Recruiter Information',
      hint: editing ? 'Leave empty to keep the current owner.' : 'Leave empty to assign the contact to you.',
      options: members.map((m) => ({ value: m.id, label: m.name })) },
    { key: 'firstName', label: 'First name', type: 'text', required: true, section: 'Recruiter Information' },
    { key: 'lastName', label: 'Last name', type: 'text', required: true, section: 'Recruiter Information' },
    { key: 'email', label: 'Email', type: 'email', section: 'Recruiter Information' },
    { key: 'accountId', label: 'Account Name', type: 'select', clearable: true, section: 'Recruiter Information',
      options: accounts.map((a) => ({ value: a.id, label: a.name })) },
    { key: 'typeOfLead', label: 'Type of Lead', type: 'select', clearable: true, section: 'Recruiter Information',
      options: opts(TYPE_OF_LEAD_OPTIONS) },
    { key: 'recruiterTriggers', label: 'Recruiter Triggers', type: 'text', full: true, section: 'Recruiter Information',
      placeholder: 'e.g. Posted 3 jobs in the last week' },
    // Contact Information (profile extras)
    { key: 'title', label: 'Title', type: 'text', section: 'Contact Information' },
    { key: 'department', label: 'Department', type: 'text', section: 'Contact Information' },
    { key: 'assistant', label: 'Assistant', type: 'text', section: 'Contact Information' },
    { key: 'leadSource', label: 'Lead source', type: 'select', clearable: true, section: 'Contact Information',
      options: sources.map((s) => ({ value: s, label: s })) },
    { key: 'birthday', label: 'Birthday', type: 'date', section: 'Contact Information' },
    // Form Details (Company · Employee Range · LinkedIn URL · Mobile · Total Ops)
    { key: 'company', label: 'Company', type: 'text', section: 'Form Details' },
    { key: 'employeeRange', label: 'Employee Range', type: 'select', clearable: true, section: 'Form Details',
      options: opts(EMPLOYEE_RANGES) },
    { key: 'linkedinUrl', label: 'LinkedIn URL', type: 'url', section: 'Form Details',
      placeholder: 'https://linkedin.com/in/…' },
    { key: 'phone', label: 'Mobile', type: 'phone', section: 'Form Details' },
    { key: 'totalOps', label: 'Total Ops', type: 'number', section: 'Form Details' },
    // Reachout TAT & CSM Status
    { key: 'csmNextStep', label: 'CSM Next Step', type: 'select', section: 'Reachout TAT & CSM Status',
      hint: 'The follow-up due date is set automatically and a follow-up task is created.',
      options: CSM_STEPS.map((s) => ({ value: s.value, label: s.value })) },
    { key: 'csmStatus', label: 'CSM Status', type: 'text', section: 'Reachout TAT & CSM Status',
      placeholder: 'e.g. Onboarded, Follow-up pending' },
    { key: 'csmRecruiterType', label: 'CSM Recruiter Type', type: 'select', clearable: true, section: 'Reachout TAT & CSM Status',
      options: opts(CSM_RECRUITER_TYPES) },
    { key: 'totalReachoutsDone', label: 'Total Reachouts Done', type: 'number', section: 'Reachout TAT & CSM Status' },
    { key: 'reachoutTat', label: 'Reachout TAT', type: 'text', section: 'Reachout TAT & CSM Status',
      placeholder: 'e.g. Same day, 24 hours' },
    { key: 'firstConversationAt', label: 'First Conversation Call', type: 'date', section: 'Reachout TAT & CSM Status' },
    { key: 'totalConversationsHad', label: 'Total Conversations Had', type: 'number', section: 'Reachout TAT & CSM Status' },
    { key: 'hiringRoles', label: 'How many & for what roles are you hiring?', type: 'text', full: true, section: 'Reachout TAT & CSM Status' },
    { key: 'dateApproved', label: 'Last Listing Date', type: 'date', section: 'Reachout TAT & CSM Status' },
    { key: 'lastReachedOutAt', label: 'Last Reached-Out Time', type: 'date', section: 'Reachout TAT & CSM Status' },
    { key: 'csmNextCallDate', label: 'CSM Next Call Date', type: 'date', section: 'Reachout TAT & CSM Status' },
    { key: 'joiningTimeline', label: 'How soon you want the candidate to join?', type: 'select', clearable: true, section: 'Reachout TAT & CSM Status',
      options: opts(JOINING_TIMELINES) },
    { key: 'otherPlatformUsed', label: 'Have you used any other platform?', type: 'text', section: 'Reachout TAT & CSM Status' },
    { key: 'recruiterFeedback', label: 'Recruiter Feedback', type: 'textarea', full: true, section: 'Reachout TAT & CSM Status' },
    // Paid Plan Pitch & Details
    { key: 'paidPlanPitch', label: 'Paid Plan Pitch', type: 'textarea', full: true, section: 'Paid Plan Pitch & Details' },
    { key: 'premiumStatus', label: 'Paid Plan Purchased', type: 'select', clearable: true, section: 'Paid Plan Pitch & Details',
      options: opts(PREMIUM_STATUSES), hint: 'Free or Paid — drives the premium badge everywhere' },
    { key: 'livePremiumOps', label: 'No. of Live Premium Ops', type: 'number', section: 'Paid Plan Pitch & Details' },
    { key: 'postPitchLeadType', label: 'Post Pitch Lead type', type: 'select', clearable: true, section: 'Paid Plan Pitch & Details',
      options: opts(POST_PITCH_LEAD_TYPES) },
    { key: 'paidPlanPitchDate', label: 'Date of Paid Plan Pitch', type: 'date', section: 'Paid Plan Pitch & Details' },
    { key: 'paidPlanFeedback', label: 'Paid Recruiter Subjective Feedback', type: 'textarea', full: true, section: 'Paid Plan Pitch & Details' },
    { key: 'paidPlanExpiryDate', label: 'Paid Plan Expiry Date', type: 'date', section: 'Paid Plan Pitch & Details' },
    // Additional Recruiter Details
    { key: 'addRecruiterName', label: 'Name (Add)', type: 'text', section: 'Additional Recruiter Details' },
    { key: 'addRecruiterDesignation', label: 'Designation', type: 'text', section: 'Additional Recruiter Details' },
    { key: 'addRecruiterMobile', label: 'Mobile Number (Add)', type: 'phone', section: 'Additional Recruiter Details' },
    // Preferences
    { key: 'doNotCall', label: 'Do not call', type: 'checkbox', section: 'Preferences', hint: 'Mark this contact as call-restricted' },
    { key: 'emailOptOut', label: 'Email opt out', type: 'checkbox', section: 'Preferences', hint: 'Exclude from email campaigns' },
    // Description Information
    { key: 'description', label: 'Description', type: 'textarea', section: 'Description Information' },
    // Listing Intelligence — latest-listing mirrors (additive section)
    { key: 'recruiterTag', label: 'Recruiter tag', type: 'select', clearable: true, section: 'Listing Intelligence',
      options: opts(RECRUITER_TAGS) },
    { key: 'listingSubtype', label: 'Listing subtype', type: 'select', clearable: true, section: 'Listing Intelligence',
      options: opts(LISTING_SUBTYPES) },
    { key: 'reasonableFitPct', label: 'Reasonable fit %', type: 'number', section: 'Listing Intelligence',
      placeholder: '0-100', hint: '0 to 100 — drives the color-coded fit badge' },
    { key: 'totalApplications', label: 'Total applications', type: 'number', section: 'Listing Intelligence' },
    { key: 'reasonableScoreUsers', label: 'Reasonable score users', type: 'number', section: 'Listing Intelligence' },
    { key: 'listingUrl', label: 'Listing URL', type: 'url', section: 'Listing Intelligence',
      placeholder: 'https://unstop.com/…' },
    { key: 'listingTitle', label: 'Listing title', type: 'text', section: 'Listing Intelligence' },
    { key: 'listingCategory', label: 'Listing category', type: 'multiselect', full: true, section: 'Listing Intelligence',
      options: opts(LISTING_CATEGORIES), hint: 'Select all that apply — stored as a JSON list' },
  ]

  // Load saved filters for this module
  React.useEffect(() => {
    fetch('/api/crm/saved-views?module=contact', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setSavedViews(d.views ?? []))
      .catch(() => {})
  }, [])

  const refreshSavedViews = async () => {
    try {
      const res = await fetch('/api/crm/saved-views?module=contact', { cache: 'no-store' })
      const d = await res.json()
      setSavedViews(d.views ?? [])
    } catch { /* keep the current list */ }
  }

  const saveView = async (name: string, isShared: boolean) => {
    try {
      // Persist the FULL filter state (search + quick filters + builder conds).
      await createRecord('/api/crm/saved-views', {
        module: 'contact', name, isShared,
        config: { search, filters: { ...filters, dueFilter }, conds: filterConds },
      })
      toast.success('Filter saved')
      await refreshSavedViews()
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
      await refreshSavedViews()
    } catch {
      toast.error('Failed to delete filter')
    }
  }

  /** Apply a saved filter's FULL config — search + quick filters + builder conds. */
  const applyView = (v: { name: string; config: Record<string, unknown> }) => {
    const cfg = v.config ?? {}
    setSearch(String(cfg.search ?? ''))
    const f = (cfg.filters ?? null) as Record<string, unknown> | null
    setFilters({
      ownerId: f?.ownerId ? String(f.ownerId) : '',
      leadSource: f?.leadSource ? String(f.leadSource) : '',
      accountId: f?.accountId ? String(f.accountId) : '',
      csmNextStep: f?.csmNextStep ? String(f.csmNextStep) : '',
    })
    setDueFilter(f?.dueFilter ? String(f.dueFilter) : '')
    setFilterConds(Array.isArray(cfg.conds) ? cfg.conds as FilterCond[] : [])
    toast.info(`Filter applied — ${v.name}`)
  }

  const filtersActive = Object.values(filters).filter(Boolean).length + (dueFilter ? 1 : 0) + filterConds.length
  const clearFilters = () => { setFilters({ ...EMPTY_FILTERS }); setDueFilter(''); setFilterConds([]) }

  if (detail) {
    const emails = safeJsonParse<string[]>(detail.emails, [])
    const phones = safeJsonParse<string[]>(detail.phones, [])
    const phone = phones[0] ?? ''
    return (
      <>
        <DetailView
          module="contact"
          recordId={detail.id}
          recordName={`${detail.firstName} ${detail.lastName}`}
          onBack={() => setDetail(null)}
          onEdit={() => { setDetail(null); openEdit(detail) }}
          onNavigateRecord={(id) => { void openContactById(id) }}
          onFieldEdit={async (field, value) => { await onDetailFieldEdit(detail, field, value) }}
          headerActions={
            <>
              <Button variant="outline" size="sm" onClick={() => openEmail(detail)} title="Email this contact" disabled={!emails[0]}>
                <Mail className="mr-1.5 size-3.5" /> Email
              </Button>
              <Button variant="outline" size="sm" onClick={() => void openWhatsapp(detail)} title="Open WhatsApp chat" disabled={!phone}>
                <MessageCircle className="mr-1.5 size-3.5" /> WhatsApp
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" title="Change owner">
                    <UserCog className="mr-1.5 size-3.5" /> {nameById.get(detail.ownerId ?? '') ?? 'Owner'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                  {members.map((m) => (
                    <DropdownMenuItem key={m.id} disabled={detail.ownerId === m.id} onClick={() => { void changeOwner(detail.id, m.id) }}>
                      {m.name}
                      {detail.ownerId === m.id && <span className="ml-auto text-xs text-muted-foreground">current</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
          cadence={
            <CsmCadenceCard
              step={detail.csmNextStep || 'None'}
              dueAt={detail.csmNextStepDueAt}
              changedAt={detail.csmNextStepAt}
              onChange={async (next) => {
                try {
                  await updateRecord('/api/crm/contacts', detail.id, { csmNextStep: next })
                  toast.success(`Next step set — ${next}`)
                  await refreshDetail(detail.id)
                  reload()
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Could not set the next step')
                }
              }}
            />
          }
          fields={[
            { key: 'firstName', label: 'First name', value: detail.firstName, editable: true },
            { key: 'lastName', label: 'Last name', value: detail.lastName, editable: true },
            { key: 'title', label: 'Title', value: detail.title ?? '', editable: true },
            { key: 'owner', label: 'Contact Owner', value: nameById.get(detail.ownerId ?? '') ?? '—' },
            { key: 'email', label: 'Email', value: emails[0] ?? '', editable: true },
            { key: 'phone', label: 'Mobile', value: phone, editable: true },
            { key: 'account', label: 'Account Name', value: detail.accountId ? accountName.get(detail.accountId) ?? '—' : '—' },
            { key: 'typeOfLead', label: 'Type of Lead', value: detail.typeOfLead ?? '' },
            { key: 'recruiterTriggers', label: 'Recruiter Triggers', value: detail.recruiterTriggers ?? '' },
            { key: 'department', label: 'Department', value: detail.department ?? '', editable: true },
            { key: 'assistant', label: 'Assistant', value: detail.assistant ?? '', editable: true },
            { key: 'leadSource', label: 'Lead source', value: detail.leadSource ?? '', editable: true },
            { key: 'csmNextStep', label: 'Next step', value: detail.csmNextStep || 'None' },
            { key: 'csmNextStepDueAt', label: 'Follow-up due', value: detail.csmNextStepDueAt ? new Date(detail.csmNextStepDueAt).toLocaleDateString() : '—' },
            { key: 'birthday', label: 'Birthday', value: detail.birthday ? new Date(detail.birthday).toLocaleDateString() : '', editable: false },
            { key: 'doNotCall', label: 'Do not call', value: detail.doNotCall ? 'Yes' : 'No' },
            { key: 'emailOptOut', label: 'Email opt out', value: detail.emailOptOut ? 'Yes' : 'No' },
            // Multi-line — carries the import's folded "Header: value" extras.
            { key: 'description', label: 'Description', value: detail.description ?? '', editable: true },
          ]}
          sections={recruiterSections(detail, nameById)}
          emailAddress={emails[0] || undefined} emailRecord={{ id: detail.id, module: 'contact' }}
        />
        <ComposeEmailDialog
          open={!!compose && compose.record.id === detail.id}
          onOpenChange={(v) => { if (!v) setCompose(null) }}
          to={compose?.to ?? ''}
          relatedModule="contact"
          relatedId={detail.id}
          recordName={contactName(detail)}
          ownerName={nameById.get(detail.ownerId ?? '')}
          onSent={() => { void refreshDetail(detail.id) }}
        />
      </>
    )
  }

  return (
    <>
      <CrmTable
        title="Contacts"
        endpoint="/api/crm/contacts"
        columns={visibleColumns}
        tableClassName="table-fixed min-w-[2820px]"
        columnDividers
        search={search}
        onSearchChange={setSearch}
        onAdd={openNew}
        onRowClick={openDetail}
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
        exportModule="contact"
        exportQuery={{ ...listFilters }}
        savedViews={savedViews}
        onSaveView={saveView}
        onApplyView={applyView}
        onDeleteView={deleteSavedView}
        bulkActions={(ids, clear) => (
          <>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <CalendarClock className="mr-1.5 size-3.5" /> Set next step
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {CSM_STEPS.map((s) => (
                  <DropdownMenuItem
                    key={s.value}
                    onClick={() => {
                      notify(bulkSetStep(ids, s.value), { success: `Next step set for ${ids.length} contact${ids.length === 1 ? '' : 's'}` })
                        .then(() => { clear(); reload() })
                    }}
                  >
                    <span className={`mr-2 inline-block size-2 rounded-full ${CSM_TONE_CLASSES[s.tone].dot}`} aria-hidden />
                    {s.value}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        filterBar={(
          <>
            <Select value={filters.ownerId || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, ownerId: v === 'all' ? '' : v }))}>
              <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter by owner">
                <SelectValue placeholder="Owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.leadSource || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, leadSource: v === 'all' ? '' : v }))}>
              <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter by source">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.accountId || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, accountId: v === 'all' ? '' : v }))}>
              <SelectTrigger className="h-8 w-48 text-xs" aria-label="Filter by account">
                <SelectValue placeholder="Account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.csmNextStep || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, csmNextStep: v === 'all' ? '' : v }))}>
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="Filter by next step">
                <SelectValue placeholder="Next step" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All next steps</SelectItem>
                {CSM_STEPS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    <span className="flex items-center gap-2">
                      <span className={`inline-block size-2 rounded-full ${CSM_TONE_CLASSES[s.tone].dot}`} aria-hidden />
                      {s.value}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dueFilter || 'any'} onValueChange={(v) => setDueFilter(v === 'any' ? '' : v)}>
              <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter by follow-up due date">
                <SelectValue placeholder="Follow-up due" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any due date</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="today">Due today</SelectItem>
                <SelectItem value="week">Due within 7 days</SelectItem>
              </SelectContent>
            </Select>
            <FilterBuilder
              fields={CONTACT_FILTER_FIELDS}
              conds={filterConds}
              onChange={setFilterConds}
              onSaveFilter={(name) => saveView(name, false)}
              savedCount={savedViews.length}
            />
          </>
        )}
        filtersActiveCount={filtersActive}
        activeFilters={[
          ...(filters.ownerId
            ? [{ key: 'owner', label: `Owner: ${nameById.get(filters.ownerId) ?? 'Owner'}`, onRemove: () => setFilters((f) => ({ ...f, ownerId: '' })) }]
            : []),
          ...(filters.leadSource
            ? [{ key: 'leadSource', label: `Source: ${filters.leadSource}`, onRemove: () => setFilters((f) => ({ ...f, leadSource: '' })) }]
            : []),
          ...(filters.accountId
            ? [{ key: 'accountId', label: `Account: ${accountName.get(filters.accountId) ?? 'Account'}`, onRemove: () => setFilters((f) => ({ ...f, accountId: '' })) }]
            : []),
          ...(filters.csmNextStep
            ? [{ key: 'csmNextStep', label: `Next step: ${filters.csmNextStep}`, onRemove: () => setFilters((f) => ({ ...f, csmNextStep: '' })) }]
            : []),
          ...(dueFilter
            ? [{
                key: 'due',
                label: `Follow-up: ${dueFilter === 'overdue' ? 'Overdue' : dueFilter === 'today' ? 'Due today' : 'Due within 7 days'}`,
                onRemove: () => setDueFilter(''),
              }]
            : []),
          ...describeConds(filterConds, CONTACT_FILTER_FIELDS).map((c) => ({
            ...c,
            onRemove: () => setFilterConds((cs) => cs.filter((x) => x.id !== c.key)),
          })),
        ]}
        onClearFilters={clearFilters}
        emptyMessage="No contacts yet. Add one manually or import a CSV/Excel file."
        rowActions={(r) => (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <CalendarClock className="mr-2 size-4" /> Set next step
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {CSM_STEPS.map((s) => (
                  <DropdownMenuItem key={s.value} onClick={() => setStep(r, s.value)}>
                    <span className={`mr-2 inline-block size-2 rounded-full ${CSM_TONE_CLASSES[s.tone].dot}`} aria-hidden />
                    {s.value}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserCog className="mr-2 size-4" /> Change owner
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                {members.map((m) => (
                  <DropdownMenuItem key={m.id} disabled={r.ownerId === m.id} onClick={() => { void changeOwner(r.id, m.id) }}>
                    {m.name}
                    {r.ownerId === m.id && <span className="ml-auto text-xs text-muted-foreground">current</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => openEmail(r)} disabled={!safeJsonParse<string[]>(r.emails ?? '[]', [])[0]}>
              <Mail className="mr-2 size-4" /> Email
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void openWhatsapp(r)}>
              <MessageCircle className="mr-2 size-4" /> WhatsApp
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openEdit(r)}><Pencil className="mr-2 size-4" /> Edit</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => notify(deleteRecord('/api/crm/contacts', r.id), { success: 'Moved to trash' }).then(reload)}>
              <Trash2 className="mr-2 size-4" /> Move to trash
            </DropdownMenuItem>
          </>
        )}
      />
      <RecordForm
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) reloadAccounts() }}
        title={editing ? 'Edit contact' : 'New contact'}
        description={editing ? 'Update contact information, preferences and custom fields.' : 'Fill in the contact information. Fields marked * are required.'}
        fields={FIELDS}
        initial={initial}
        module="contact"
        initialCustom={editingCustom}
        onSave={save}
      />
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        module="contact"
        moduleLabel="contacts"
        onImported={reload}
      />
      {compose && !detail && (
        <ComposeEmailDialog
          open={!!compose}
          onOpenChange={(v) => { if (!v) setCompose(null) }}
          to={compose.to}
          relatedModule="contact"
          relatedId={compose.record.id}
          recordName={contactName(compose.record)}
          ownerName={nameById.get(compose.record.ownerId ?? '')}
          onSent={reload}
        />
      )}
    </>
  )
}
