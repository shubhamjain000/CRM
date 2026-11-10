import { db } from '@/lib/db'
import { ensureDefaultPipeline } from './convert'
import { computeDocumentTotals } from './inventory'
import { CSM_STEPS } from '@/lib/csm'

const FIRST_NAMES = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan',
  'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Aaradhya', 'Priya', 'Pari', 'Navya', 'Kiara', 'Myra',
  'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Emma', 'Olivia', 'Sophia', 'Isabella',
  'Liam', 'Noah', 'Ethan', 'Lucas', 'Mason', 'Ava', 'Mia', 'Charlotte', 'Amelia', 'Harper']
const LAST_NAMES = ['Sharma', 'Patel', 'Gupta', 'Singh', 'Kumar', 'Reddy', 'Nair', 'Iyer', 'Mehta', 'Joshi',
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez']
const COMPANIES = ['Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Pied Piper', 'Vandelay', 'Stark Industries',
  'Wayne Enterprises', 'Wonka Inc', 'Soylent', 'Cyberdyne', 'Tyrell', 'Weyland', 'Massive Dynamic',
  'Oscorp', 'Aperture Science', 'Black Mesa', 'LexCorp', 'Gringotts']
const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Manufacturing', 'Retail', 'Education', 'Energy', 'Media', 'Real Estate', 'Transportation']
const SOURCES = ['Website', 'Referral', 'Cold Call', 'Email Campaign', 'Social Media', 'Trade Show', 'Partner', 'Advertisement']
const STATUSES = ['new', 'contacted', 'qualified', 'unqualified']
const RATINGS = ['hot', 'warm', 'cold']

/** Indian mobile number: +91 followed by a 10-digit number starting 6-9, grouped 5-5. */
function inPhone(): string { return `+91 ${randInt(60000, 99999)} ${randInt(10000, 99999)}` }

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function pickN<T>(arr: T[], n: number): T[] {
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(pick(arr))
  return out
}
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min }

const TARGETS = { accounts: 60, contacts: 120, leads: 250, deals: 60, activities: 120, invoices: 30,
  tasks: 45, notes: 60, calls: 35, events: 20 } as const

/**
 * CSM cadence mix applied to seeded contacts (canonical values from
 * src/lib/csm.ts). Roughly mirrors a live sales org: most contacts are inside
 * an active loop (some already overdue / due today so the CSM Cadence BI page
 * and the follow-up call list have real data on day one), a parked Old-Lead
 * bucket and a completed-loop bucket close the distribution.
 * offset = days the step was set in the past; overdueShift = extra days added
 * to the due date (only for a subset, via modulo) so "overdue" is populated.
 */
const CSM_MIX: { value: string; share: number; setDaysAgo: number; everyNthOverdue: number }[] = [
  { value: 'Day 0',             share: 0.10, setDaysAgo: 0,  everyNthOverdue: 3 },
  { value: 'Day 0 reconnect',   share: 0.07, setDaysAgo: 0,  everyNthOverdue: 2 },
  { value: 'Day 1 Reconnect',   share: 0.09, setDaysAgo: 1,  everyNthOverdue: 4 },
  { value: 'Day 3 Call',        share: 0.11, setDaysAgo: 3,  everyNthOverdue: 5 },
  { value: 'Day 3 Reconnect',   share: 0.06, setDaysAgo: 3,  everyNthOverdue: 4 },
  { value: 'Day 7',             share: 0.09, setDaysAgo: 7,  everyNthOverdue: 6 },
  { value: 'Day 14 Call',       share: 0.07, setDaysAgo: 14, everyNthOverdue: 5 },
  { value: 'Old Lead',          share: 0.07, setDaysAgo: 45, everyNthOverdue: 0 },
  { value: 'CSM Loop complete', share: 0.09, setDaysAgo: 21, everyNthOverdue: 0 },
]

const LISTING_CATEGORIES = ['Engineering', 'Sales', 'Marketing', 'Operations', 'Design', 'Analytics', 'Customer Success', 'Finance']
const LISTING_TITLES = ['Growth Intern (Remote)', 'SDR — Enterprise', 'Marketing Analyst', 'Backend Engineer', 'Campus Ambassador', 'Product Manager — Platform', 'Associate Consultant', 'Data Engineer']

/** Realistic activity copy per action — rotated across the seeded timeline. */
const ACTIVITY_COPY: { action: string; descriptions: string[] }[] = [
  {
    action: 'called',
    descriptions: [
      'Discovery call — walked through their current workflow',
      'Follow-up call about pricing and rollout timeline',
      'Quick check-in call; decision expected next week',
      'Call to confirm requirements before the demo',
    ],
  },
  {
    action: 'emailed',
    descriptions: [
      'Sent the intro email with the pricing deck attached',
      'Shared the case-study PDF and a booking link',
      'Emailed a recap of the demo plus next steps',
      'Sent a tailored proposal draft for review',
    ],
  },
  {
    action: 'noted',
    descriptions: [
      'Logged notes: they need SSO and a Sept 1 go-live',
      'Budget confirmed internally; champion is the VP Ops',
      'Key objection is data migration effort — send the checklist',
      'Wants a reference call with a similar-sized customer',
    ],
  },
  {
    action: 'met',
    descriptions: [
      'On-site meeting at their office — toured the ops floor',
      'Video meeting: scoped the pilot with the technical team',
      'Met at the trade show booth; strong intent signaled',
      'Quarterly review meeting with the stakeholder group',
    ],
  },
]

const INVOICE_ITEM_NAMES = [
  'CRM Starter License (annual)', 'CRM Enterprise License (annual)',
  'Onboarding & implementation services', 'Premium support (annual)',
  'Data migration pack', 'Marketing add-on seats',
  'Additional user seats (10-pack)', 'API usage overage — monthly',
]

/**
 * Seed demo CRM data for an organization: 30 accounts, 50 contacts, 100 leads,
 * 20 deals, 50 activities and 15 invoices.
 *
 * Count-based idempotency: each module is topped up to its target, so a partially
 * completed previous run (server restart / crash mid-seed) is self-healed by the
 * next click instead of being blocked by a sentinel. The sentinel custom field is
 * only written AFTER a fully successful run as a fast path.
 *
 * Every seeded record is flagged isSeed:true so "Delete All Seed Data" can remove
 * exactly what the seeder created — real data is never touched.
 *
 * Returns how many records were created in THIS run plus the resulting totals.
 */
export async function seedCrmData(organizationId: string, ownerId: string): Promise<{
  created: { accounts: number; contacts: number; leads: number; deals: number; activities: number; invoices: number; tasks: number; notes: number; calls: number; events: number }
  totals: { accounts: number; contacts: number; leads: number; deals: number; activities: number; invoices: number; tasks: number; notes: number; calls: number; events: number }
}> {
  const count = () => Promise.all([
    db.account.count({ where: { organizationId, deletedAt: null } }),
    db.contact.count({ where: { organizationId, deletedAt: null } }),
    db.lead.count({ where: { organizationId, deletedAt: null } }),
    db.deal.count({ where: { organizationId, deletedAt: null } }),
    db.activity.count({ where: { organizationId } }),
    db.invoice.count({ where: { organizationId } }),
    db.task.count({ where: { organizationId, deletedAt: null } }),
    db.note.count({ where: { organizationId } }),
    db.call.count({ where: { organizationId, deletedAt: null } }),
    db.event.count({ where: { organizationId, deletedAt: null } }),
  ])

  const [a0, c0, l0, d0, act0, inv0, t0, n0, cl0, ev0] = await count()

  // ---- Inventory / Campaigns demo top-up (only when the modules are empty) ----
  // Same count-based idempotency as the core modules. Runs BEFORE the fast
  // path so orgs that were seeded before these modules existed also get the
  // demo data on their next "Seed demo data" click.
  const seedInventoryDemo = async () => {
    const p0 = await db.product.count({ where: { organizationId, deletedAt: null } })
    if (p0 > 0) return
    const demoProducts = [
      { name: 'CRM Starter License', productCode: 'LIC-START', category: 'Software', unit: 'License', unitPrice: 14999, taxPercent: 18 },
      { name: 'CRM Enterprise License', productCode: 'LIC-ENT', category: 'Software', unit: 'License', unitPrice: 74999, taxPercent: 18 },
      { name: 'Onboarding Services (10h)', productCode: 'SVC-ONB', category: 'Services', unit: 'Package', unitPrice: 45000, taxPercent: 18 },
      { name: 'Premium Support (annual)', productCode: 'SVC-SUP', category: 'Services', unit: 'Year', unitPrice: 32000, taxPercent: 18 },
      { name: 'Data Migration Pack', productCode: 'SVC-MIG', category: 'Services', unit: 'Package', unitPrice: 28000, taxPercent: 18 },
      { name: 'Marketing Add-on Seats (5)', productCode: 'ADD-MKT', category: 'Software', unit: 'Pack', unitPrice: 9999, taxPercent: 12 },
    ]
    await db.product.createMany({
      data: demoProducts.map((p) => ({ ...p, organizationId, ownerId, active: true })),
    })
    const productRows = await db.product.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true, unitPrice: true, taxPercent: true },
    })

    const book = await db.priceBook.create({
      data: {
        organizationId, ownerId, name: 'Partner Pricing 2026',
        description: '15% discounted rates for channel partners.', active: true,
      },
    })
    if (productRows.length > 0) {
      await db.priceBookEntry.createMany({
        data: productRows.slice(0, 3).map((p) => ({
          organizationId, priceBookId: book.id, productId: p.id,
          price: Math.round(p.unitPrice * 0.85 * 100) / 100,
        })),
      })
    }

    await db.vendor.createMany({
      data: [
        { organizationId, ownerId, name: 'Global Parts Trading', category: 'distributor', website: 'https://gpt.example.com', description: 'Hardware distribution partner.' },
        { organizationId, ownerId, name: 'CloudServe Solutions', category: 'service', website: 'https://cloudserve.example.com', description: 'Managed hosting and infrastructure services.' },
      ],
    })

    const docFrom = (name: string, rows: typeof productRows, status: string) => {
      const items = rows.map((p, i) => ({
        productId: p.id, name: p.name, qty: i + 1, rate: p.unitPrice,
        discountPct: i === 0 ? 10 : 0, taxPct: p.taxPercent,
      }))
      const t = computeDocumentTotals(items)
      return {
        organizationId, ownerId, name,
        items: JSON.stringify(t.items),
        subtotal: t.subtotal, discountTotal: t.discountTotal, taxTotal: t.taxTotal, grandTotal: t.grandTotal,
        currency: 'INR', status,
      }
    }
    if (productRows.length >= 2) {
      await db.quote.createMany({ data: [docFrom('Renewal quote — Acme Corp', productRows.slice(0, 2), 'sent'), docFrom('Expansion quote — Globex', productRows.slice(2, 4), 'draft')] })
      await db.salesOrder.createMany({ data: [docFrom('SO — Initech rollout', productRows.slice(0, 3), 'confirmed')] })
      const vendorRows = await db.vendor.findMany({ where: { organizationId, deletedAt: null }, select: { id: true } })
      const po = docFrom('PO — Q3 hardware replenishment', productRows.slice(3, 5), 'issued')
      await db.purchaseOrder.createMany({ data: [{ ...po, vendorId: vendorRows[0]?.id ?? null }] })
    }
  }

  const seedCampaignsDemo = async () => {
    const camp0 = await db.campaign.count({ where: { organizationId, deletedAt: null } })
    if (camp0 > 0) return
    const [demoLeads, demoContacts] = await Promise.all([
      db.lead.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, firstName: true, lastName: true }, take: 4 }),
      db.contact.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, firstName: true, lastName: true }, take: 4 }),
    ])
    const memberOf = (module: 'lead' | 'contact', rows: { id: string; firstName: string | null; lastName: string | null }[], statuses: string[]) =>
      rows.map((r, i) => ({
        module, id: r.id,
        name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || '(unnamed)',
        status: statuses[i % statuses.length],
      }))
    const membersA = [...memberOf('lead', demoLeads, ['sent', 'responded', 'responded', 'no_response']), ...memberOf('contact', demoContacts.slice(0, 2), ['sent', 'responded'])]
    const membersB = [...memberOf('contact', demoContacts.slice(2, 4), ['sent', 'no_response']), ...memberOf('lead', demoLeads.slice(0, 2), ['responded', 'bounced'])]
    await db.campaign.createMany({
      data: [
        { organizationId, ownerId, name: 'Q1 Product Launch', type: 'email', status: 'active', budget: 850000, expectedRevenue: 4500000, description: 'Launch outreach for the new platform tier.', members: JSON.stringify(membersA), startDate: new Date(Date.now() - 14 * 86400000), endDate: new Date(Date.now() + 30 * 86400000) },
        { organizationId, ownerId, name: 'Partner Webinar Series', type: 'webinar', status: 'draft', budget: 400000, expectedRevenue: 2200000, description: 'Monthly partner enablement webinars.', members: JSON.stringify(membersB), startDate: new Date(Date.now() + 7 * 86400000) },
      ],
    })
  }

  await Promise.all([seedInventoryDemo(), seedCampaignsDemo()])

  // Fast path: everything already at target and a previous run marked success.
  const fullySeeded = a0 >= TARGETS.accounts && c0 >= TARGETS.contacts
    && l0 >= TARGETS.leads && d0 >= TARGETS.deals
    && act0 >= TARGETS.activities && inv0 >= TARGETS.invoices
    && t0 >= TARGETS.tasks && n0 >= TARGETS.notes && cl0 >= TARGETS.calls && ev0 >= TARGETS.events
  if (fullySeeded) {
    const sentinel = await db.customField.findFirst({
      where: { organizationId, apiName: '__seed_sentinel__' },
    })
    if (sentinel) {
      return {
        created: { accounts: 0, contacts: 0, leads: 0, deals: 0, activities: 0, invoices: 0, tasks: 0, notes: 0, calls: 0, events: 0 },
        totals: { accounts: a0, contacts: c0, leads: l0, deals: d0, activities: act0, invoices: inv0, tasks: t0, notes: n0, calls: cl0, events: ev0 },
      }
    }
  }

  const pipelineId = await ensureDefaultPipeline(organizationId)
  const stages = await db.stage.findMany({
    where: { organizationId, pipelineId },
    orderBy: { order: 'asc' },
  })
  const openStages = stages.filter((s) => !s.isWonStage && !s.isLostStage)

  // ---- Accounts: top up to 30 -------------------------------------------------
  const accountsToCreate = Math.max(0, TARGETS.accounts - a0)
  const accountIds = (
    await db.account.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true },
      take: TARGETS.accounts,
    })
  ).map((a) => a.id)
  for (let i = 0; i < accountsToCreate; i++) {
    const company = pick(COMPANIES)
    const n = a0 + i + 1
    const a = await db.account.create({
      data: {
        organizationId,
        name: `${company} ${n}`,
        accountType: pick(['customer', 'prospect', 'partner', 'vendor']),
        industry: pick(INDUSTRIES),
        annualRevenue: randInt(10000000, 500000000),
        employees: randInt(10, 5000),
        website: `https://${company.toLowerCase().replace(/\s/g, '')}${n}.com`,
        ownerId,
        rating: pick(RATINGS),
        tags: JSON.stringify(pickN(['enterprise', 'smb', 'startup', 'priority', 'strategic'], randInt(1, 3))),
        isSeed: true,
      },
    })
    accountIds.push(a.id)
  }

  // ---- Contacts: top up to 120 (linked to accounts, CSM cadence, listing intel)
  const contactsToCreate = Math.max(0, TARGETS.contacts - c0)
  const contactIds: string[] = (
    await db.contact.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true },
      take: TARGETS.contacts,
    })
  ).map((c) => c.id)

  // Build a cadence distribution so contacts cover the whole funnel: active
  // loops (overdue/due-today/upcoming), parked and done.
  const buildCadencePlan = (total: number): { value: string; setDaysAgo: number; overdue: boolean }[] => {
    const plan: { value: string; setDaysAgo: number; overdue: boolean }[] = []
    for (const m of CSM_MIX) {
      const n = Math.round(m.share * Math.max(total, 1))
      for (let i = 0; i < n; i++) {
        plan.push({
          value: m.value,
          setDaysAgo: m.setDaysAgo,
          overdue: m.everyNthOverdue > 0 && i % m.everyNthOverdue === 1,
        })
      }
    }
    while (plan.length < total) plan.push({ value: 'None', setDaysAgo: 0, overdue: false })
    return plan
  }

  const cadencePlan = buildCadencePlan(contactsToCreate)

  /** End-of-day due date: `set date + step offset`, matching csmDueDate(). */
  const csmDue = (step: string, setAt: Date): Date | null => {
    const stepMeta = CSM_STEPS.find((s) => s.value === step)
    if (!stepMeta || stepMeta.days === null) return null
    const due = new Date(setAt)
    due.setDate(due.getDate() + stepMeta.days)
    due.setHours(23, 59, 59, 999)
    return due
  }

  for (let i = 0; i < contactsToCreate; i++) {
    const first = pick(FIRST_NAMES)
    const last = pick(LAST_NAMES)
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${c0 + i}@${pick(['example', 'acme', 'corp', 'demo'])}.com`
    const plan = cadencePlan[i % cadencePlan.length]
    const setAt = new Date(Date.now() - plan.setDaysAgo * 86400000)
    const dueAt = plan.overdue && plan.setDaysAgo > 0
      ? new Date(setAt.getTime() - randInt(1, 4) * 86400000) // deliberately past-due
      : csmDue(plan.value, setAt)
    // Listing Intelligence on every 3rd contact (mirrors the daily CSV).
    const withListing = (c0 + i) % 3 === 0
    const c = await db.contact.create({
      data: {
        organizationId,
        firstName: first,
        lastName: last,
        accountId: pick(accountIds),
        title: pick(['CEO', 'CTO', 'VP Sales', 'Marketing Director', 'Engineer', 'Product Manager', 'Analyst', 'Recruiter', 'HR Manager']),
        emails: JSON.stringify([email]),
        phones: JSON.stringify([inPhone()]),
        ownerId,
        leadSource: pick(SOURCES),
        // CSM cadence (canonical values; At/DueAt server-maintained)
        csmNextStep: plan.value,
        csmNextStepAt: plan.value === 'None' ? null : setAt,
        csmNextStepDueAt: plan.value === 'None' ? null : dueAt,
        // CSM automation fields
        csmRecruiterType: withListing ? pick(['First Time', 'Existing', 'New']) : null,
        csmStatus: withListing ? pick(['Active', 'Onboarding', 'Nurture', 'Renewal due']) : null,
        csmNextCallDate: withListing && Math.random() < 0.5 ? new Date(Date.now() + randInt(0, 10) * 86400000) : null,
        totalReachoutsDone: withListing ? randInt(0, 12) : null,
        lastReachedOutAt: withListing ? new Date(Date.now() - randInt(0, 20) * 86400000) : null,
        // Listing Intelligence (additive CSV columns)
        ...(withListing
          ? {
              recruiterTag: pick(['New Recruiter', 'Existing Recruiter']),
              premiumStatus: pick(['Free', 'Paid']),
              listingSubtype: pick(['Jobs', 'Internships']),
              totalApplications: randInt(0, 340),
              reasonableFitPct: randInt(35, 98),
              reasonableScoreUsers: randInt(0, 60),
              listingUrl: `https://unstop.example/listing/${1000 + c0 + i}`,
              listingTitle: pick(LISTING_TITLES),
              listingCategory: JSON.stringify(pickN(LISTING_CATEGORIES, randInt(1, 2))),
              dateApproved: new Date(Date.now() - randInt(1, 60) * 86400000),
            }
          : {}),
        isSeed: true,
      },
    })
    contactIds.push(c.id)
  }

  // Backfill: seed-flagged contacts from EARLIER seeder runs that never got a
  // cadence (created before this expansion) — top up their cadence mix too.
  {
    const stale = await db.contact.findMany({
      where: { organizationId, isSeed: true, csmNextStep: 'None', deletedAt: null },
      select: { id: true },
      take: 60,
    })
    const backfillPlan = buildCadencePlan(stale.length)
    for (let i = 0; i < stale.length; i++) {
      const plan = backfillPlan[i % Math.max(backfillPlan.length, 1)] ?? { value: 'None', setDaysAgo: 0, overdue: false }
      if (plan.value === 'None') continue
      const setAt = new Date(Date.now() - plan.setDaysAgo * 86400000)
      const dueAt = plan.overdue && plan.setDaysAgo > 0
        ? new Date(setAt.getTime() - randInt(1, 4) * 86400000)
        : csmDue(plan.value, setAt)
      await db.contact.update({
        where: { id: stale[i].id },
        data: { csmNextStep: plan.value, csmNextStepAt: setAt, csmNextStepDueAt: dueAt },
      })
    }
  }

  // ---- Leads: top up to 100 ----------------------------------------------------
  const leadsToCreate = Math.max(0, TARGETS.leads - l0)
  for (let i = 0; i < leadsToCreate; i++) {
    const first = pick(FIRST_NAMES)
    const last = pick(LAST_NAMES)
    await db.lead.create({
      data: {
        organizationId,
        firstName: first,
        lastName: last,
        emails: JSON.stringify([`${first.toLowerCase()}.${last.toLowerCase()}${l0 + i}@lead.demo`]),
        phones: JSON.stringify([inPhone()]),
        company: `${pick(COMPANIES)} ${randInt(1, 30)}`,
        title: pick(['Manager', 'Director', 'VP', 'Coordinator', 'Specialist']),
        leadSource: pick(SOURCES),
        leadStatus: pick(STATUSES),
        rating: pick(RATINGS),
        industry: pick(INDUSTRIES),
        annualRevenue: randInt(2000000, 200000000),
        employees: randInt(5, 2000),
        website: `https://lead${l0 + i}.demo`,
        ownerId,
        createdById: ownerId,
        score: randInt(0, 100),
        lastActivity: new Date(Date.now() - randInt(0, 30) * 24 * 60 * 60 * 1000),
        isSeed: true,
      },
    })
  }

  // ---- Deals: top up to 60 — spread across OPEN stages, plus won/lost so the
  // funnel, win/loss and velocity BI charts have real closed data on day one.
  const dealsToCreate = Math.max(0, TARGETS.deals - d0)
  const wonStages = stages.filter((s) => s.isWonStage)
  const lostStages = stages.filter((s) => s.isLostStage)
  for (let i = 0; i < dealsToCreate; i++) {
    // ~72% open pipeline, ~18% closed-won, ~10% closed-lost.
    const roll = (d0 + i) % 50
    let stage = pick(openStages.length > 0 ? openStages : stages)
    let isClosed = false
    let lost = false
    if (roll >= 45 && lostStages.length > 0) {
      stage = pick(lostStages)
      isClosed = true
      lost = true
    } else if (roll >= 36 && wonStages.length > 0) {
      stage = pick(wonStages)
      isClosed = true
    }
    if (!stage) break // no pipeline stages yet — deals cannot be created
    const amount = randInt(200000, 8000000)
    const closeDate = new Date(Date.now() + randInt(-10, 60) * 24 * 60 * 60 * 1000)
    await db.deal.create({
      data: {
        organizationId,
        name: `${pick(COMPANIES)} — Deal ${d0 + i + 1}`,
        amount,
        currency: 'INR',
        stageId: stage.id,
        pipelineId,
        closeDate,
        probability: stage.probability,
        accountId: pick(accountIds),
        primaryContactId: pick(contactIds),
        ownerId,
        leadSource: pick(SOURCES),
        type: pick(['new_business', 'existing_business', 'renewal']),
        nextStep: isClosed ? null : pick(['Discovery call', 'Send proposal', 'Follow up', 'Demo scheduled', 'Negotiate terms']),
        description: isClosed
          ? `Seeded closed deal for BI: ${lost ? 'lost' : 'won'} with amount ₹${amount.toLocaleString('en-IN')}.`
          : null,
        lostReason: lost ? pick(['Price too high', 'Chose a competitor', 'No budget this quarter', 'Timing — postponed', 'Went with an in-house build']) : null,
        forecastCategory: isClosed ? 'closed' : pick(['pipeline', 'best_case', 'commit']),
        isSeed: true,
      },
    })
  }

  // ---- Activities: top up to 50 (spread across the seeded CRM records) --------
  const activitiesToCreate = Math.max(0, TARGETS.activities - act0)
  if (activitiesToCreate > 0) {
    const [poolAccounts, poolContacts, poolLeads, poolDeals] = await Promise.all([
      db.account.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, name: true }, take: 50 }),
      db.contact.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, firstName: true, lastName: true }, take: 50 }),
      db.lead.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, firstName: true, lastName: true }, take: 100 }),
      db.deal.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, name: true }, take: 50 }),
    ])
    const targets: { module: string; recordId: string; recordName: string }[] = [
      ...poolAccounts.map((a) => ({ module: 'account', recordId: a.id, recordName: a.name })),
      ...poolContacts.map((c) => ({ module: 'contact', recordId: c.id, recordName: `${c.firstName} ${c.lastName}`.trim() })),
      ...poolLeads.map((l) => ({ module: 'lead', recordId: l.id, recordName: `${l.firstName} ${l.lastName}`.trim() })),
      ...poolDeals.map((d) => ({ module: 'deal', recordId: d.id, recordName: d.name })),
    ]
    if (targets.length > 0) {
      const now = Date.now()
      await db.activity.createMany({
        data: Array.from({ length: activitiesToCreate }, (_, i) => {
          const target = targets[(act0 + i) % targets.length]
          const copy = pick(ACTIVITY_COPY)
          // Spread createdAt across the last 30 days.
          const createdAt = new Date(now - randInt(0, 30 * 24 * 60) * 60_000)
          return {
            organizationId,
            userId: ownerId,
            module: target.module,
            recordId: target.recordId,
            recordName: target.recordName,
            action: copy.action,
            description: pick(copy.descriptions),
            metadata: JSON.stringify({ source: 'seed' }),
            createdAt,
            isSeed: true,
          }
        }),
      })
    }
  }

  // ---- Invoices: top up to 15 (customers mirror the seeded accounts) ----------
  const invoicesToCreate = Math.max(0, TARGETS.invoices - inv0)
  if (invoicesToCreate > 0) {
    const [poolAccounts, poolContacts] = await Promise.all([
      db.account.findMany({
        where: { organizationId, deletedAt: null },
        select: { name: true },
        orderBy: { createdAt: 'asc' },
        take: 30,
      }),
      db.contact.findMany({
        where: { organizationId, deletedAt: null },
        select: { emails: true },
        take: 50,
      }),
    ])
    const contactEmails = poolContacts
      .map((c) => { try { const arr = JSON.parse(c.emails || '[]'); return Array.isArray(arr) && typeof arr[0] === 'string' ? arr[0] : '' } catch { return '' } })
      .filter(Boolean)
    const customers = poolAccounts.length > 0
      ? poolAccounts.map((a) => a.name)
      : ['Acme Corp']
    const now = Date.now()
    await db.invoice.createMany({
      data: Array.from({ length: invoicesToCreate }, (_, i) => {
        // Unique sequential numbers INV-2xxx (offset by existing invoices so
        // repeated top-up runs never collide).
        const invoiceNumber = `INV-${2000 + inv0 + i + 1}`
        const lineItems = Array.from({ length: randInt(1, 3) }, () => {
          const qty = randInt(1, 5)
          const rate = randInt(5000, 50000)
          return { name: pick(INVOICE_ITEM_NAMES), qty, rate, amount: qty * rate }
        })
        const subtotal = lineItems.reduce((s, li) => s + li.amount, 0)
        const tax = Math.round(subtotal * 0.18)
        const status = pick(['draft', 'sent', 'paid', 'overdue'])
        // issued over the last 60 days; overdue invoices are already past due
        const issueDate = new Date(now - randInt(0, 60) * 24 * 60 * 60 * 1000)
        const dueDate = status === 'overdue'
          ? new Date(now - randInt(1, 15) * 24 * 60 * 60 * 1000)
          : new Date(issueDate.getTime() + randInt(7, 30) * 24 * 60 * 60 * 1000)
        return {
          organizationId,
          customerName: customers[(inv0 + i) % customers.length],
          customerEmail: contactEmails.length > 0 ? pick(contactEmails) : null,
          invoiceNumber,
          issueDate,
          dueDate,
          subtotal,
          tax,
          total: subtotal + tax,
          status,
          lineItems: JSON.stringify(lineItems),
          notes: status === 'overdue' ? 'Auto-reminder scheduled — payment past due.' : null,
          isSeed: true,
        }
      }),
    })
  }

  // ---- Tasks: top up to 45 — CSM follow-ups, calls, proposals, admin ----------
  const tasksToCreate = Math.max(0, TARGETS.tasks - t0)
  if (tasksToCreate > 0 && contactIds.length > 0) {
    const TASK_COPY = [
      { title: 'CSM follow-up call — {{name}}', kind: 'csm' },
      { title: 'Send pricing proposal — {{company}}', kind: 'proposal' },
      { title: 'Discovery call — {{company}}', kind: 'call' },
      { title: 'Prepare onboarding checklist — {{company}}', kind: 'admin' },
      { title: 'Quarterly business review prep — {{company}}', kind: 'admin' },
      { title: 'Collect renewal documents — {{company}}', kind: 'admin' },
      { title: 'Demo follow-up email — {{name}}', kind: 'csm' },
    ]
    const accountNames = (
      await db.account.findMany({ where: { organizationId, deletedAt: null }, select: { name: true }, take: 60 })
    ).map((a) => a.name)
    const now = Date.now()
    await db.task.createMany({
      data: Array.from({ length: tasksToCreate }, (_, i) => {
        const t = pick(TASK_COPY)
        const contact = contactIds[i % contactIds.length]
        const company = accountNames.length > 0 ? pick(accountNames) : 'Acme Corp'
        // Spread due dates from -5 days (overdue) to +14 days (upcoming).
        const due = new Date(now + randInt(-5, 14) * 86400000)
        due.setHours(23, 59, 0, 0)
        const past = due.getTime() < now
        return {
          organizationId,
          title: t.title.replace('{{name}}', pick(FIRST_NAMES)).replace('{{company}}', company),
          description: t.kind === 'csm'
            ? 'Auto-created by the CSM cadence (seeded) — close the touchpoint or advance the next step.'
            : 'Seeded task — created with demo data.',
          dueDate: due,
          priority: pick(['low', 'medium', 'medium', 'high', 'urgent']),
          status: past ? (i % 3 === 0 ? 'completed' : 'in_progress') : 'not_started',
          assigneeId: ownerId,
          ownerId,
          createdById: ownerId,
          relatedModule: t.kind === 'csm' ? 'contact' : null,
          relatedId: t.kind === 'csm' ? contact : null,
          tags: JSON.stringify(t.kind === 'csm' ? ['csm-cadence', 'seed'] : ['seed']),
          lastActivity: new Date(now),
          isSeed: true,
        }
      }),
    })
  }

  // ---- Notes: top up to 60 — cadence kinds across accounts/contacts/leads/deals
  const notesToCreate = Math.max(0, TARGETS.notes - n0)
  if (notesToCreate > 0) {
    const [poolAccounts, poolContacts, poolLeads, poolDeals] = await Promise.all([
      db.account.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, name: true }, take: 60 }),
      db.contact.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, firstName: true, lastName: true }, take: 120 }),
      db.lead.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, firstName: true, lastName: true }, take: 250 }),
      db.deal.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, name: true }, take: 60 }),
    ])
    const NOTE_COPY: { kind: string; bodies: string[] }[] = [
      { kind: 'day-0', bodies: ['Day 0 completed — walked the recruiter through the listing flow, shared the onboarding deck.', 'Day 0 touchpoint done. Strong fit; agreed to a reconnect tomorrow.'] },
      { kind: 'day-1-reconnect', bodies: ['Day 1 reconnect done — they reviewed the pricing internally, moving to a Day 3 call.', 'Reconnected as planned; objections around data migration, sent the checklist.'] },
      { kind: 'day-3-followup', bodies: ['Day 3 call done — technical team joined, pilot scoped for two listings.', 'Follow-up call complete. Champion is the VP Ops; procurement next.'] },
      { kind: 'week-1-checkin', bodies: ['Week-1 check-in — usage healthy (12 reachouts logged), renewal on track.', 'Check-in done: asked for a reference call with a similar-sized customer.'] },
      { kind: 'call-outcome', bodies: ['Connected — decision expected next week, send the recap email.', 'Voicemail; retry scheduled tomorrow morning.'] },
      { kind: 'meeting', bodies: ['On-site meeting — toured the ops floor, rollout planned for next month.', 'Video meeting: scoped the pilot, action items shared with the group.'] },
      { kind: 'objection', bodies: ['Key objection: migration effort. Agreed to a phased migration plan.', 'Price objection — offered the partner discount schedule for review.'] },
      { kind: 'next-steps', bodies: ['Next steps: legal review → signature → kickoff scheduled.', 'Next steps: send updated SOW, then loop in the security questionnaire.'] },
    ]
    const targets = [
      ...poolAccounts.map((a) => ({ module: 'account', recordId: a.id })),
      ...poolContacts.map((c) => ({ module: 'contact', recordId: c.id })),
      ...poolLeads.map((l) => ({ module: 'lead', recordId: l.id })),
      ...poolDeals.map((d) => ({ module: 'deal', recordId: d.id })),
    ]
    if (targets.length > 0) {
      const now = Date.now()
      await db.note.createMany({
        data: Array.from({ length: notesToCreate }, (_, i) => {
          const copy = pick(NOTE_COPY)
          const target = targets[(n0 + i) % targets.length]
          return {
            organizationId,
            userId: ownerId,
            module: target.module,
            recordId: target.recordId,
            kind: copy.kind,
            body: pick(copy.bodies),
            mentions: '[]',
            hashtags: '[]',
            isSeed: true,
            createdAt: new Date(now - randInt(0, 30) * 86400000),
          }
        }),
      })
    }
  }

  // ---- Calls: top up to 35 — realistic outcomes across the last 30 days -------
  const callsToCreate = Math.max(0, TARGETS.calls - cl0)
  if (callsToCreate > 0) {
    const CALL_SUBJECTS = [
      'Discovery call', 'Pricing follow-up', 'Demo walkthrough', 'Renewal check-in',
      'Onboarding kick-off', 'Objection handling', 'Quarterly review', 'Intro call',
    ]
    const now = Date.now()
    await db.call.createMany({
      data: Array.from({ length: callsToCreate }, (_, i) => {
        const outcome = pick(['connected', 'connected', 'connected', 'voicemail', 'no_answer', 'busy'])
        const started = new Date(now - randInt(0, 30) * 86400000 - randInt(0, 8) * 3600000)
        const duration = outcome === 'connected' ? randInt(120, 2400) : randInt(5, 40)
        return {
          organizationId,
          subject: pick(CALL_SUBJECTS),
          callType: pick(['outbound', 'outbound', 'outbound', 'inbound', 'missed']),
          duration,
          outcome,
          sentiment: outcome === 'connected' ? pick(['positive', 'positive', 'neutral', 'negative']) : null,
          relatedModule: contactIds.length > 0 ? 'contact' : null,
          relatedId: contactIds.length > 0 ? contactIds[(cl0 + i) % contactIds.length] : null,
          voipProvider: pick(['seed-demo', 'seed-telephony']),
          notes: outcome === 'connected' ? 'Seeded call — logged with demo data.' : 'No connection; follow up later.',
          startedAt: started,
          endedAt: new Date(started.getTime() + duration * 1000),
          ownerId,
          isSeed: true,
        }
      }),
    })
  }

  // ---- Events: top up to 20 — calendar spread over the last 2 / next 3 weeks --
  const eventsToCreate = Math.max(0, TARGETS.events - ev0)
  if (eventsToCreate > 0) {
    const EVENT_COPY = [
      { title: 'Discovery call — {{company}}', mins: 30 },
      { title: 'Product demo — {{company}}', mins: 45 },
      { title: 'Quarterly business review — {{company}}', mins: 60 },
      { title: 'Onboarding workshop — {{company}}', mins: 90 },
      { title: 'Renewal negotiation — {{company}}', mins: 45 },
      { title: 'Team pipeline review', mins: 30 },
    ]
    const accountNames = (
      await db.account.findMany({ where: { organizationId, deletedAt: null }, select: { name: true }, take: 60 })
    ).map((a) => a.name)
    const now = Date.now()
    await db.event.createMany({
      data: Array.from({ length: eventsToCreate }, (_, i) => {
        const copy = pick(EVENT_COPY)
        const company = accountNames.length > 0 ? pick(accountNames) : 'Acme Corp'
        // -14 to +21 days from now, business-hours start.
        const start = new Date(now + randInt(-14, 21) * 86400000)
        start.setHours(pick([10, 11, 13, 14, 15, 16]), pick([0, 30]), 0, 0)
        const end = new Date(start.getTime() + copy.mins * 60000)
        return {
          organizationId,
          title: copy.title.replace('{{company}}', company),
          description: 'Seeded calendar event — created with demo data.',
          start,
          end,
          location: pick(['Google Meet', 'Zoom', 'Client office', '—']),
          externalAttendees: JSON.stringify([`${pick(FIRST_NAMES).toLowerCase()}@${pick(['acme', 'globex', 'initech'])}.com`]),
          conferenceProvider: pick(['google_meet', 'zoom', 'none']),
          status: 'confirmed',
          organizerId: ownerId,
          visibility: 'busy',
          isSeed: true,
        }
      }),
    })
  }

  // Sentinel only after a fully successful run (fast path for future clicks).
  await db.customField.upsert({
    where: { organizationId_module_apiName: { organizationId, module: 'lead', apiName: '__seed_sentinel__' } },
    update: {},
    create: {
      organizationId,
      module: 'lead',
      label: '__seed_sentinel__',
      apiName: '__seed_sentinel__',
      fieldType: 'text',
      isActive: false,
    },
  })

  const [a1, c1, l1, d1, act1, inv1, t1, n1, cl1, ev1] = await count()
  return {
    created: {
      accounts: a1 - a0,
      contacts: c1 - c0,
      leads: l1 - l0,
      deals: d1 - d0,
      activities: act1 - act0,
      invoices: inv1 - inv0,
      tasks: t1 - t0,
      notes: n1 - n0,
      calls: cl1 - cl0,
      events: ev1 - ev0,
    },
    totals: { accounts: a1, contacts: c1, leads: l1, deals: d1, activities: act1, invoices: inv1, tasks: t1, notes: n1, calls: cl1, events: ev1 },
  }
}
