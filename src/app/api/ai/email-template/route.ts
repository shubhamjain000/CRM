import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// AI email templates with record context (task 53-d / FIX 15)
//
// POST /api/ai/email-template
//   body: {
//     category: 'follow_up' | 'introduction' | 'proposal' | 'reminder' (required)
//     module?:  'lead' | 'contact' | 'deal' | 'account'   (required when recordId given)
//     recordId?: string                                    (loads the real record)
//     instruction?: string                                 (extra one-line guidance)
//     context?: { name?, company?, ownerName? }            (generic mode — no recordId)
//   }
//   200 → { subject, body, category, variables }
//   4xx/5xx → { error }
//
// The body is plain text with "\n\n" paragraph breaks; {{…}} placeholders the
// model may still emit are resolved SERVER-side against real record values
// before the response is returned. Nothing user-visible is persisted except a
// best-effort AIWriterDraft row.
// ---------------------------------------------------------------------------

const CATEGORY_LABELS = {
  follow_up: 'Follow Up',
  introduction: 'Introduction',
  proposal: 'Proposal',
  reminder: 'Reminder',
} as const

type CategoryKey = keyof typeof CATEGORY_LABELS
type ModuleName = 'lead' | 'contact' | 'deal' | 'account'
const MODULES: ModuleName[] = ['lead', 'contact', 'deal', 'account']

interface EmailVars {
  first_name: string
  last_name: string
  full_name: string
  email: string
  phone: string
  company: string
  deal_name: string
  deal_stage: string
  owner_name: string
  date: string
}

/** Parse a JSON-array column (emails/phones) safely — bad/missing data yields []. */
function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Replace known {{…}} merge fields with real values; unknown tokens stay visible for the client note. */
function resolveVars(text: string, vars: EmailVars): string {
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, key: string) => {
    const k = key.toLowerCase()
    return (k in vars) ? vars[k as keyof EmailVars] : match
  })
}

/** Tolerant JSON extraction: strips code fences and surrounding prose (same pattern as the chat handler). */
function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const s = cleaned.indexOf('{')
  const e = cleaned.lastIndexOf('}')
  if (s === -1 || e <= s) return null
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(s, e + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function clean(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return String(amount)
  }
}

async function loadOwnerName(ownerId: string): Promise<string> {
  if (!ownerId) return ''
  const user = await db.user.findUnique({ where: { id: ownerId }, select: { name: true } })
  return user?.name ?? ''
}

/**
 * Load the record for the given module (tenant-scoped) and build both the
 * {{…}} variable map and a human-readable context summary for the LLM.
 * Returns null when the record does not exist in this organization.
 */
async function loadRecordContext(
  moduleName: ModuleName,
  recordId: string,
  organizationId: string,
): Promise<{ vars: EmailVars; summary: string } | null> {
  const date = fmtDate(new Date())
  const emptyVars: EmailVars = { first_name: '', last_name: '', full_name: '', email: '', phone: '', company: '', deal_name: '', deal_stage: '', owner_name: '', date }

  if (moduleName === 'lead') {
    const lead = await db.lead.findFirst({ where: { id: recordId, organizationId, deletedAt: null } })
    if (!lead) return null
    const vars: EmailVars = {
      ...emptyVars,
      first_name: lead.firstName,
      last_name: lead.lastName,
      full_name: `${lead.firstName} ${lead.lastName}`.trim(),
      email: parseJsonArray(lead.emails)[0] ?? '',
      phone: parseJsonArray(lead.phones)[0] ?? '',
      company: lead.company ?? '',
      owner_name: await loadOwnerName(lead.ownerId),
      date,
    }
    const summary = [
      '- Module: Lead',
      `- Name: ${vars.full_name || '(unknown)'}`,
      lead.company ? `- Company: ${lead.company}` : '',
      `- Lead status: ${lead.leadStatus}`,
      lead.rating ? `- Rating: ${lead.rating}` : '',
      lead.industry ? `- Industry: ${lead.industry}` : '',
      vars.email ? `- Email: ${vars.email}` : '',
      vars.owner_name ? `- Owner (sender): ${vars.owner_name}` : '',
      `- Today: ${date}`,
    ].filter(Boolean).join('\n')
    return { vars, summary }
  }

  if (moduleName === 'contact') {
    const contact = await db.contact.findFirst({
      where: { id: recordId, organizationId, deletedAt: null },
      include: { account: { select: { name: true } } },
    })
    if (!contact) return null
    const vars: EmailVars = {
      ...emptyVars,
      first_name: contact.firstName,
      last_name: contact.lastName,
      full_name: `${contact.firstName} ${contact.lastName}`.trim(),
      email: parseJsonArray(contact.emails)[0] ?? '',
      phone: parseJsonArray(contact.phones)[0] ?? '',
      company: contact.account?.name ?? '',
      owner_name: await loadOwnerName(contact.ownerId),
      date,
    }
    const summary = [
      '- Module: Contact',
      `- Name: ${vars.full_name || '(unknown)'}`,
      contact.title ? `- Title: ${contact.title}` : '',
      vars.company ? `- Company: ${vars.company}` : '',
      `- Cadence step: ${contact.csmNextStep || 'None'}`,
      vars.email ? `- Email: ${vars.email}` : '',
      vars.owner_name ? `- Owner (sender): ${vars.owner_name}` : '',
      `- Today: ${date}`,
    ].filter(Boolean).join('\n')
    return { vars, summary }
  }

  if (moduleName === 'deal') {
    const deal = await db.deal.findFirst({
      where: { id: recordId, organizationId, deletedAt: null },
      include: {
        stage: { select: { name: true } },
        account: { select: { name: true } },
        primaryContact: { select: { firstName: true, lastName: true, emails: true, phones: true } },
      },
    })
    if (!deal) return null
    const pc = deal.primaryContact
    const vars: EmailVars = {
      ...emptyVars,
      first_name: pc?.firstName ?? '',
      last_name: pc?.lastName ?? '',
      full_name: pc ? `${pc.firstName} ${pc.lastName}`.trim() : deal.name,
      email: pc ? parseJsonArray(pc.emails)[0] ?? '' : '',
      phone: pc ? parseJsonArray(pc.phones)[0] ?? '' : '',
      company: deal.account?.name ?? '',
      deal_name: deal.name,
      deal_stage: deal.stage?.name ?? '',
      owner_name: await loadOwnerName(deal.ownerId),
      date,
    }
    const summary = [
      '- Module: Deal',
      `- Deal: ${deal.name}`,
      vars.company ? `- Company: ${vars.company}` : '',
      `- Stage: ${vars.deal_stage || '(none)'}`,
      `- Value: ${fmtMoney(deal.amount, deal.currency)}`,
      vars.full_name ? `- Primary contact: ${vars.full_name}` : '',
      deal.closeDate ? `- Expected close: ${fmtDate(new Date(deal.closeDate))}` : '',
      vars.owner_name ? `- Owner (sender): ${vars.owner_name}` : '',
      `- Today: ${date}`,
    ].filter(Boolean).join('\n')
    return { vars, summary }
  }

  // account
  const account = await db.account.findFirst({ where: { id: recordId, organizationId, deletedAt: null } })
  if (!account) return null
  const vars: EmailVars = {
    ...emptyVars,
    first_name: account.name,
    full_name: account.name,
    company: account.name,
    owner_name: await loadOwnerName(account.ownerId),
    date,
  }
  const summary = [
    '- Module: Account',
    `- Company: ${account.name}`,
    account.accountType ? `- Account type: ${account.accountType}` : '',
    account.industry ? `- Industry: ${account.industry}` : '',
    account.annualRevenue ? `- Annual revenue: ${fmtMoney(account.annualRevenue, 'INR')}` : '',
    vars.owner_name ? `- Owner (sender): ${vars.owner_name}` : '',
    `- Today: ${date}`,
  ].filter(Boolean).join('\n')
  return { vars, summary }
}

/** Generic (no recordId) mode — build variables from whatever context the client passed. */
function genericContext(
  moduleName: ModuleName | null,
  context: { name?: string; company?: string; ownerName?: string },
): { vars: EmailVars; summary: string } {
  const date = fmtDate(new Date())
  const name = clean(context.name, 120)
  const nameParts = name.split(/\s+/).filter(Boolean)
  const vars: EmailVars = {
    first_name: nameParts[0] ?? '',
    last_name: nameParts.length > 1 ? nameParts.slice(1).join(' ') : '',
    full_name: name,
    email: '',
    phone: '',
    company: clean(context.company, 120),
    deal_name: '',
    deal_stage: '',
    owner_name: clean(context.ownerName, 120),
    date,
  }
  const moduleLine = moduleName
    ? `- Module: ${moduleName[0].toUpperCase()}${moduleName.slice(1)} (record not linked — write generally but professionally)`
    : '- Record: not linked (write a general but professional email)'
  const summary = [
    moduleLine,
    vars.full_name ? `- Recipient: ${vars.full_name}` : '',
    vars.company ? `- Company: ${vars.company}` : '',
    vars.owner_name ? `- Sender: ${vars.owner_name}` : '',
    `- Today: ${date}`,
  ].filter(Boolean).join('\n')
  return { vars, summary }
}

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 400 })
    const organizationId = tenant.organization.id

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // --- Validation (400 with clear messages) ---
    const category = clean(body.category, 40).toLowerCase()
    if (!category) return NextResponse.json({ error: 'Category is required' }, { status: 400 })
    if (!(category in CATEGORY_LABELS)) {
      return NextResponse.json({ error: `Invalid category "${category}". Use one of: ${Object.keys(CATEGORY_LABELS).join(', ')}.` }, { status: 400 })
    }

    const rawModule = clean(body.module, 20).toLowerCase()
    const recordId = clean(body.recordId, 64)
    if (recordId && !rawModule) {
      return NextResponse.json({ error: 'module is required when recordId is provided' }, { status: 400 })
    }
    if (rawModule && !MODULES.includes(rawModule as ModuleName)) {
      return NextResponse.json({ error: `Invalid module "${rawModule}". Use one of: ${MODULES.join(', ')}.` }, { status: 400 })
    }
    if (typeof body.instruction === 'string' && body.instruction.trim().length > 500) {
      return NextResponse.json({ error: 'Instruction must be 500 characters or fewer' }, { status: 400 })
    }
    const instruction = clean(body.instruction, 500)
    const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context)
      ? { name: clean(body.context.name, 120), company: clean(body.context.company, 120), ownerName: clean(body.context.ownerName, 120) }
      : {}

    // --- Load record context ---
    let resolved: { vars: EmailVars; summary: string }
    if (recordId) {
      const loaded = await loadRecordContext(rawModule as ModuleName, recordId, organizationId)
      if (!loaded) return NextResponse.json({ error: 'Record not found in your organization' }, { status: 404 })
      resolved = loaded
    } else {
      resolved = genericContext(rawModule ? (rawModule as ModuleName) : null, context)
    }

    // --- LLM call (same SDK pattern as the chat handler) ---
    const label = CATEGORY_LABELS[category as CategoryKey]
    const systemPrompt = [
      'You are an expert sales email writer for the Unstop CRM platform.',
      `Write a ${label} email using the real record context provided.`,
      '',
      'Rules:',
      '- Professional, concise and human. 120–180 words in the body.',
      '- Reference the real context (name, company, deal stage, owner) naturally. NEVER invent facts, numbers, discounts or dates that are not in the context.',
      '- Subject: specific and concrete, at most 70 characters, no "Re:" prefix.',
      '- Body: PLAIN TEXT only — paragraphs separated by one blank line. No markdown, no HTML, no bullet glyphs.',
      '- Greet the recipient by first name when known; otherwise use a neutral professional greeting.',
      '- Exactly one clear call to action.',
      `- Sign off with the sender's name when known, otherwise "The Unstop team".`,
      instruction ? `- Follow this extra instruction from the user: "${instruction}"` : '',
      '',
      'Return exactly ONE JSON object and nothing else — no prose before or after:',
      '{"subject": "<subject line>", "body": "<plain-text body with \\n\\n between paragraphs>"}',
    ].filter(Boolean).join('\n')

    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `RECORD CONTEXT (real CRM data):\n${resolved.summary}` },
      ],
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices?.[0]?.message?.content ?? ''
    const parsed = extractJson(raw)
    const subjectRaw = typeof parsed?.subject === 'string' ? parsed.subject.trim() : ''
    const bodyRaw = typeof parsed?.body === 'string' ? parsed.body.trim() : ''
    if (!parsed || !subjectRaw || !bodyRaw) {
      return NextResponse.json({ error: 'The AI service returned an unusable response. Please try again.' }, { status: 500 })
    }

    // Resolve any {{…}} placeholders the model still emitted, server-side.
    const subject = resolveVars(subjectRaw, resolved.vars).slice(0, 150)
    const emailBody = resolveVars(bodyRaw, resolved.vars)

    // Best-effort audit trail in the existing AI Writer drafts table.
    try {
      await db.aIWriterDraft.create({
        data: {
          organizationId,
          userId: session.userId,
          draftType: 'email',
          prompt: `[${label}] ${instruction || recordId || 'no instruction'}`,
          generatedContent: `Subject: ${subject}\n\n${emailBody}`,
          style: category,
          tone: 'professional',
        },
      })
    } catch {
      /* persistence is optional — never fail the response over it */
    }

    return NextResponse.json({ subject, body: emailBody, category, variables: resolved.vars })
  } catch (e) {
    console.error('[email-template] generation failed:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Email generation failed. Please try again.' },
      { status: 500 },
    )
  }
}
