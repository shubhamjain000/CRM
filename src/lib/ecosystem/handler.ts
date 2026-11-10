import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import {
  buildAuthHeaders, CUSTOM_API_PROVIDER, extractRows, mergeSavedSecrets,
  parseConfig, redactConfig,
  type ApiImportConfig,
} from '@/lib/integrations/api-import'
import {
  getProviderSpec, parseProviderConfig, redactProviderConfig,
  validateProviderValues,
} from '@/lib/integrations/providers'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

interface CatalogItem {
  name: string
  developer: string
  category: string
  pricing: string
  isVerified: boolean
  isFeatured?: boolean
  description: string
  /** Longer copy shown on the marketplace detail sheet. */
  details: string
  /** Scopes the app requests — surfaced on the detail sheet before install. */
  permissions: string[]
  /** Marketplace popularity stats for the detail sheet. */
  rating: number
  downloads: number
  /** When set, installing also guarantees an Integration row for this provider
   *  so the app shows up under Ecosystem → Integrations. */
  provider?: string
}

const CATALOG: CatalogItem[] = [
  {
    name: 'Google Workspace', developer: 'Google', category: 'productivity', pricing: 'free', isVerified: true, isFeatured: true, provider: 'google_workspace',
    description: 'Calendar sync, Drive, Gmail, Contacts',
    details: 'Two-way Google Calendar sync, Gmail email logging on record timelines, Drive attachment storage and Contacts mirroring — your team keeps working from Gmail while the CRM stays current.',
    permissions: ['Read calendar events', 'Send email as you', 'Manage Drive files shared with the app', 'Read/write contacts'],
    rating: 4.6, downloads: 48200,
  },
  {
    name: 'Slack', developer: 'Slack', category: 'communication', pricing: 'free', isVerified: true, isFeatured: true, provider: 'slack',
    description: 'Notifications, slash commands, lead/deal alerts',
    details: 'Push deal-won, lead-assigned and workflow alerts into Slack channels, run /unstop lookups, and create follow-up tasks without leaving the conversation.',
    permissions: ['Post messages to channels you choose', 'Respond to slash commands', 'Read channel names and topics'],
    rating: 4.7, downloads: 61350,
  },
  {
    name: 'Zoom', developer: 'Zoom', category: 'communication', pricing: 'freemium', isVerified: true, isFeatured: true, provider: 'zoom',
    description: 'Meeting creation, recording + transcript sync',
    details: 'Schedule Zoom meetings from any deal or contact, attach recordings and AI transcripts to the record timeline, and auto-log attendance after every call.',
    permissions: ['Create meetings on your behalf', 'Access meeting recordings and transcripts', 'Read meeting participant lists'],
    rating: 4.4, downloads: 39900,
  },
  {
    name: 'QuickBooks', developer: 'Intuit', category: 'accounting', pricing: 'paid', isVerified: true, provider: 'quickbooks',
    description: 'Invoice sync, customer match, payment sync',
    details: 'Match CRM accounts to QuickBooks customers, sync invoices and payment status onto deals, and see outstanding balances next to every account.',
    permissions: ['Read customers and invoices', 'Read payment status', 'Create draft invoices'],
    rating: 4.3, downloads: 18700,
  },
  {
    name: 'Stripe', developer: 'Stripe', category: 'payments', pricing: 'paid', isVerified: true, isFeatured: true, provider: 'stripe',
    description: 'Payment to deal close, subscription sync',
    details: 'Close the loop between revenue and pipeline: successful Stripe payments mark deals won, recurring subscriptions sync to accounts, and MRR lands on the executive dashboard.',
    permissions: ['Read charges and invoices', 'Read customer records', 'Receive webhook events'],
    rating: 4.8, downloads: 52100,
  },
  {
    name: 'Razorpay', developer: 'Razorpay', category: 'payments', pricing: 'freemium', isVerified: true, provider: 'razorpay',
    description: 'UPI, cards, netbanking (India)',
    details: 'Collect payments over UPI, cards and netbanking with payment links attached to deals; settlements and refunds reconcile back onto the deal automatically.',
    permissions: ['Create payment links', 'Read payment and refund status', 'Receive webhook events'],
    rating: 4.5, downloads: 27400,
  },
  {
    name: 'DocuSign', developer: 'DocuSign', category: 'esignature', pricing: 'paid', isVerified: true, provider: 'docusign',
    description: 'E-signature on contracts',
    details: 'Send proposals and contracts for signature straight from a deal, track envelope status in real time, and archive the executed PDF on the record when it completes.',
    permissions: ['Create envelopes from templates', 'Read envelope status', 'Download completed documents'],
    rating: 4.6, downloads: 15800,
  },
  {
    name: 'Mailchimp', developer: 'Intuit', category: 'marketing', pricing: 'freemium', isVerified: true, provider: 'mailchimp',
    description: 'Sync contacts, campaign metrics',
    details: 'Keep Mailchimp audiences aligned with CRM contacts, attribute opens and clicks back to leads, and score engagement without exporting spreadsheets.',
    permissions: ['Manage audience members', 'Read campaign reports', 'Subscribe and unsubscribe contacts'],
    rating: 4.2, downloads: 22600,
  },
  {
    name: 'Clearbit', developer: 'Clearbit', category: 'enrichment', pricing: 'paid', isVerified: true, provider: 'clearbit',
    description: 'Company/contact enrichment',
    details: 'Auto-fill company size, industry, funding and role data on every new lead and account, keeping records complete without manual research.',
    permissions: ['Enrich person records by email', 'Enrich company records by domain'],
    rating: 4.4, downloads: 12300,
  },
  {
    name: 'Hunter.io', developer: 'Hunter', category: 'enrichment', pricing: 'freemium', isVerified: true, provider: 'hunter',
    description: 'Email finder (name + company to email)',
    details: 'Find verified business emails from a name and company domain, with deliverability confidence scores so outreach bounces less.',
    permissions: ['Search email addresses by domain', 'Verify deliverability of an address'],
    rating: 4.3, downloads: 9800,
  },
  {
    name: 'Calendly', developer: 'Calendly', category: 'scheduling', pricing: 'freemium', isVerified: true, provider: 'calendly',
    description: 'Meeting scheduling embed',
    details: 'Drop your Calendly availability into emails and the CRM; booked meetings create calendar events and log attendance on the contact automatically.',
    permissions: ['Read scheduled events', 'Read invitee details', 'Create scheduling links'],
    rating: 4.6, downloads: 31500,
  },
  {
    name: 'Zapier', developer: 'Zapier', category: 'automation', pricing: 'freemium', isVerified: true, isFeatured: true, provider: 'zapier',
    description: '5000+ app connections',
    details: 'Trigger Zaps from any CRM event (new lead, stage change, task due) and push data into 5000+ connected apps — no code required.',
    permissions: ['Send record events to your Zaps', 'Accept actions that create/update records'],
    rating: 4.5, downloads: 44700,
  },
  {
    name: 'HubSpot Migration', developer: 'Foundation', category: 'migration', pricing: 'free', isVerified: true,
    description: 'Import from HubSpot',
    details: 'One-time migration that pulls contacts, companies and deals out of HubSpot with owners, stages and custom field mapping handled for you.',
    permissions: ['Read all HubSpot records via API key', 'Write records into this CRM'],
    rating: 4.1, downloads: 6400,
  },
  {
    name: 'Salesforce Migration', developer: 'Foundation', category: 'migration', pricing: 'free', isVerified: true,
    description: 'Import from Salesforce',
    details: 'One-time migration from Salesforce: leads, accounts, opportunities and notes are mapped into the matching CRM modules with idempotent re-runs.',
    permissions: ['Read Salesforce objects via connected app', 'Write records into this CRM'],
    rating: 4.0, downloads: 5100,
  },
  {
    name: 'Zoho Migration', developer: 'Foundation', category: 'migration', pricing: 'free', isVerified: true,
    description: 'Import from Zoho CRM',
    details: 'One-time migration from Zoho CRM covering leads, contacts, accounts and deals — field mappings and picklist translation included.',
    permissions: ['Read Zoho CRM modules via API', 'Write records into this CRM'],
    rating: 4.0, downloads: 4700,
  },
] as const

export { CATALOG }

export async function listExtensions() { return CATALOG }

export async function getInstalledExtensions() {
  const { tenant } = await ctx()
  return db.installedExtension.findMany({ where: { organizationId: tenant.organization.id }, include: { extension: true } })
}

export async function installExtension(extensionName: string) {
  const { session, tenant } = await ctx()
  const orgId = tenant.organization.id
  let ext = await db.extension.findFirst({ where: { name: extensionName } })
  if (!ext) {
    const c = CATALOG.find(x => x.name === extensionName)
    if (!c) throw new Error('Extension not found')
    ext = await db.extension.create({ data: { name: c.name, developer: c.developer, category: c.category, pricing: c.pricing, isVerified: c.isVerified, isFeatured: c.isFeatured, description: c.description, downloads: c.downloads, rating: c.rating, permissions: JSON.stringify(c.permissions) } })
  } else {
    await db.extension.update({ where: { id: ext.id }, data: { downloads: { increment: 1 } } })
  }
  // Active on install with a fresh lastSyncedAt so the marketplace badge and
  // the integrations panel reflect the new install immediately.
  const installed = await db.installedExtension.upsert({
    where: { organizationId_extensionId: { organizationId: orgId, extensionId: ext.id } },
    create: { organizationId: orgId, extensionId: ext.id, status: 'active', lastSyncedAt: new Date() },
    update: { status: 'active', lastSyncedAt: new Date() },
  })
  // Catalog apps that map to a connector provider get their Integration row
  // created (not auto-connected) so they appear under Ecosystem → Integrations.
  const catalogEntry = CATALOG.find(x => x.name === ext!.name)
  if (catalogEntry?.provider) {
    await db.integration.upsert({
      where: { organizationId_provider: { organizationId: orgId, provider: catalogEntry.provider } },
      create: { organizationId: orgId, provider: catalogEntry.provider, isConnected: false },
      update: {},
    })
  }
  await audit({ organizationId: orgId, actorId: session.userId, action: 'extension.install', targetType: 'extension', targetId: ext.id })
  return { ...installed, extension: ext }
}

/**
 * Uninstall = disable + scrub the stored config. The InstalledExtension row is
 * KEPT (status 'disabled') as an audit trail of the install/uninstall cycle;
 * clearing `config` removes any app-local settings/secrets the extension held.
 */
export async function uninstallExtension(extensionId: string) {
  const { session, tenant } = await ctx()
  await db.installedExtension.updateMany({
    where: { extensionId, organizationId: tenant.organization.id },
    data: { status: 'disabled', config: '{}' },
  })
  await audit({ organizationId: tenant.organization.id, actorId: session.userId, action: 'extension.uninstall', targetType: 'extension', targetId: extensionId })
}

export async function listInvoices() {
  const { tenant } = await ctx()
  return db.invoice.findMany({ where: { organizationId: tenant.organization.id }, orderBy: { createdAt: 'desc' }, take: 200 })
}

export async function createInvoice(data: { customerName: string; customerEmail?: string; lineItems?: any[]; dueDate?: string }) {
  const { session, tenant } = await ctx()
  const lineItems = data.lineItems ?? []
  const subtotal = lineItems.reduce((s: number, i: any) => s + (i.quantity * i.rate), 0)
  const tax = subtotal * 0.18
  const total = subtotal + tax
  const count = await db.invoice.count({ where: { organizationId: tenant.organization.id } })
  return db.invoice.create({
    data: {
      organizationId: tenant.organization.id,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      invoiceNumber: `INV-${String(count + 1).padStart(4, '0')}`,
      dueDate: data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 30 * 86400000),
      subtotal, tax, total,
      lineItems: JSON.stringify(lineItems),
    },
  })
}

export async function listTickets() {
  const { tenant } = await ctx()
  return db.ticket.findMany({ where: { organizationId: tenant.organization.id }, orderBy: { createdAt: 'desc' }, take: 200 })
}

export async function createTicket(data: { subject: string; description?: string; priority?: string; requesterName?: string; requesterEmail?: string }) {
  const { session, tenant } = await ctx()
  // requesterName is a required column — fall back to the acting user so a
  // blank "Requester name" field never 500s ticket creation.
  const requesterName = (data.requesterName ?? '').trim() || session.name || 'Support requester'
  return db.ticket.create({
    data: {
      organizationId: tenant.organization.id,
      subject: data.subject,
      description: data.description,
      priority: data.priority,
      requesterName,
      requesterEmail: data.requesterEmail,
      assignedToId: session.userId,
    },
  })
}

export async function listProjects() {
  const { tenant } = await ctx()
  return db.project.findMany({ where: { organizationId: tenant.organization.id }, orderBy: { createdAt: 'desc' }, take: 200 })
}

export async function createProject(data: { name: string; description?: string }) {
  const { session, tenant } = await ctx()
  return db.project.create({ data: { organizationId: tenant.organization.id, name: data.name, description: data.description, managerId: session.userId } })
}

export async function listIntegrations() {
  const { tenant } = await ctx()
  const rows = await db.integration.findMany({
    where: { organizationId: tenant.organization.id },
    include: { logs: { orderBy: { createdAt: 'desc' }, take: 5 } },
    orderBy: { updatedAt: 'desc' },
  })
  // Redact stored secrets before the config leaves the server; the UI passes
  // "__SAVED__" back unchanged on save and mergeSavedSecrets restores them.
  // Provider rows expose their redacted config too so the connect wizard can
  // prefill non-secret fields and keep stored secrets intact.
  return rows.map((r) => {
    if (r.provider === CUSTOM_API_PROVIDER) {
      return { ...r, config: JSON.stringify(redactConfig(parseConfig(r.config))), logs: r.logs }
    }
    const spec = getProviderSpec(r.provider)
    if (!spec) return { ...r, config: '{}', logs: r.logs }
    return { ...r, config: JSON.stringify(redactProviderConfig(r.provider, parseProviderConfig(r.config))), logs: r.logs }
  })
}

/** Save (or update) the single custom API auto-import connection. */
export async function saveApiImport(config: Record<string, unknown>) {
  const { session, tenant } = await ctx()
  const orgId = tenant.organization.id
  const existing = await db.integration.findUnique({
    where: { organizationId_provider: { organizationId: orgId, provider: CUSTOM_API_PROVIDER } },
  })
  const next = mergeSavedSecrets(config as Partial<ApiImportConfig>, parseConfig(existing?.config))
  // Records created by the feed are owned by the admin who configured it.
  const withOwner = { ...next, ownerId: session.userId }
  const integration = await db.integration.upsert({
    where: { organizationId_provider: { organizationId: orgId, provider: CUSTOM_API_PROVIDER } },
    create: {
      organizationId: orgId,
      provider: CUSTOM_API_PROVIDER,
      isConnected: true,
      config: JSON.stringify(withOwner),
    },
    update: { isConnected: true, config: JSON.stringify(withOwner) },
  })
  await db.integrationLog.create({
    data: { organizationId: orgId, integrationId: integration.id, event: 'configured', status: 'info', details: `Target ${String(config.targetModule ?? 'lead')} · schedule ${String(config.scheduleMinutes ?? 0) || 'off'} min` },
  })
  await audit({ organizationId: orgId, actorId: session.userId, action: 'integration.configure', targetType: 'integration', targetId: integration.id, metadata: { provider: CUSTOM_API_PROVIDER } })
  return integration
}

/**
 * Connect a provider integration. Marketplace providers have a connect spec:
 * the request must carry credential values, which are validated server-side
 * (format + required fields) before anything is stored. Unchanged secret
 * fields arrive redacted as "__SAVED__" and keep their previously stored
 * value. Providers without a spec keep the legacy toggle behavior.
 */
export async function connectIntegration(provider: string, values?: Record<string, unknown>) {
  const { session, tenant } = await ctx()
  const orgId = tenant.organization.id
  const spec = getProviderSpec(provider)

  let configJson = '{}'
  let details = `Connected ${provider}`
  if (spec) {
    if (!values || typeof values !== 'object') {
      throw new Error(`${spec.label} needs credentials — open Connect and fill in the setup steps.`)
    }
    const existing = await db.integration.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider } },
    })
    const saved = parseProviderConfig(existing?.config)
    const result = validateProviderValues(provider, values, saved)
    if (!result.ok) throw new Error(result.error ?? 'Invalid credentials')
    // Only spec-known keys are persisted.
    const clean: Record<string, string> = {}
    for (const f of spec.fields) clean[f.key] = result.clean?.[f.key] ?? ''
    configJson = JSON.stringify(clean)
    const setFields = spec.fields.filter((f) => clean[f.key]).map((f) => f.label).join(', ')
    details = `Credentials saved for ${setFields || 'no fields'}`
  }

  const integration = await db.integration.upsert({
    where: { organizationId_provider: { organizationId: orgId, provider } },
    create: { organizationId: orgId, provider, isConnected: true, config: configJson },
    update: spec ? { isConnected: true, config: configJson } : { isConnected: true },
  })
  await db.integrationLog.create({ data: { organizationId: orgId, integrationId: integration.id, event: 'connected', status: 'info', details } })
  await audit({ organizationId: orgId, actorId: session.userId, action: 'integration.connect', targetType: 'integration', targetId: integration.id, metadata: { provider } })
  return integration
}

/**
 * Disconnect also clears the stored credentials so secrets never linger on a
 * disconnected integration. (Re-connecting always goes through the wizard.)
 */
export async function disconnectIntegration(provider: string) {
  const { session, tenant } = await ctx()
  const integration = await db.integration.findUnique({ where: { organizationId_provider: { organizationId: tenant.organization.id, provider } } })
  if (!integration) return
  await db.integration.update({ where: { id: integration.id }, data: { isConnected: false, config: '{}' } })
  await db.integrationLog.create({ data: { organizationId: tenant.organization.id, integrationId: integration.id, event: 'disconnected', status: 'info' } })
  await audit({ organizationId: tenant.organization.id, actorId: session.userId, action: 'integration.disconnect', targetType: 'integration', targetId: integration.id, metadata: { provider } })
}

export interface TestOutcome {
  ok: boolean
  message: string
  latencyMs?: number
  /** custom_api only: rows detected in the sample response. */
  sampleCount?: number
  /** custom_api only: response keys that would not map into the CRM. */
  unmappedSampleKeys?: string[]
}

/**
 * Verify a saved integration actually works, per provider kind:
 *  - custom_api → a REAL fetch of the configured endpoint (with its auth),
 *    reporting how many rows the response would yield.
 *  - spec providers → the stored credentials are re-validated (required
 *    fields present, correct key formats) and the result is logged.
 * Failures are recorded in IntegrationLog so the row status flips to Error.
 */
export async function testIntegration(id: string): Promise<TestOutcome> {
  const { tenant } = await ctx()
  const integration = await db.integration.findFirst({
    where: { id, organizationId: tenant.organization.id },
  })
  if (!integration) throw new Error('Integration not found')
  const started = Date.now()

  const log = async (ok: boolean, message: string) => {
    await db.integrationLog.create({
      data: {
        organizationId: tenant.organization.id,
        integrationId: integration.id,
        event: 'tested',
        status: ok ? 'success' : 'error',
        details: message,
      },
    })
  }

  // ---- custom API feed: genuinely reach the endpoint ----------------------
  if (integration.provider === CUSTOM_API_PROVIDER) {
    const cfg = parseConfig(integration.config)
    if (!cfg.endpointUrl) {
      const out: TestOutcome = { ok: false, message: 'No endpoint configured yet — press Edit and set the URL.' }
      await log(false, out.message)
      return out
    }
    try {
      const res = await fetch(cfg.endpointUrl, {
        method: cfg.method ?? 'GET',
        headers: buildAuthHeaders(cfg),
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      })
      const latency = Date.now() - started
      if (!res.ok) {
        const out: TestOutcome = { ok: false, message: `Endpoint replied HTTP ${res.status} ${res.statusText}`, latencyMs: latency }
        await log(false, out.message)
        return out
      }
      let sampleCount = 0
      let unmapped: string[] = []
      try {
        const payload: unknown = await res.json()
        const rows = extractRows(payload, cfg.rowsPath)
        sampleCount = rows.length
        if (cfg.fieldMapping && rows.length > 0) {
          const mapped = new Set(cfg.fieldMapping.split(/\n+/).map((l) => l.split('=')[0]?.trim()).filter(Boolean))
          unmapped = Object.keys(rows[0]).filter((k) => !mapped.has(k)).slice(0, 8)
        }
      } catch { /* non-JSON or unmappable body — reachability already proven */ }
      const out: TestOutcome = {
        ok: true,
        message: sampleCount > 0 ? `Endpoint reachable — ${sampleCount} row(s) in the current response.` : 'Endpoint reachable (no JSON rows detected — check Rows path).',
        latencyMs: latency,
        sampleCount,
        ...(unmapped.length > 0 ? { unmappedSampleKeys: unmapped } : {}),
      }
      await log(true, out.message)
      return out
    } catch (e) {
      const out: TestOutcome = { ok: false, message: e instanceof Error ? `Could not reach the endpoint: ${e.message}` : 'Could not reach the endpoint.' }
      await log(false, out.message)
      return out
    }
  }

  // ---- spec providers: re-validate stored credentials ---------------------
  const spec = getProviderSpec(integration.provider)
  if (!spec) {
    // Legacy/toggle provider — connectivity is the flag itself.
    if (!integration.isConnected) {
      const out: TestOutcome = { ok: false, message: `${integration.provider} is disconnected — press Connect first.` }
      await log(false, out.message)
      return out
    }
    const out: TestOutcome = { ok: true, message: `${integration.provider} is connected.`, latencyMs: Date.now() - started }
    await log(true, out.message)
    return out
  }

  const saved = parseProviderConfig(integration.config)
  const hasAny = spec.fields.some((f) => (saved[f.key] ?? '').length > 0)
  if (!hasAny) {
    const out: TestOutcome = { ok: false, message: `No credentials saved yet — press Connect and follow the ${spec.steps.length} setup steps.`, latencyMs: Date.now() - started }
    await log(false, out.message)
    return out
  }
  const result = validateProviderValues(integration.provider, saved)
  const latency = Date.now() - started
  if (!result.ok) {
    const out: TestOutcome = { ok: false, message: result.error ?? 'Saved credentials are invalid.', latencyMs: latency }
    await log(false, out.message)
    return out
  }
  const missing = spec.fields.filter((f) => f.required && !(saved[f.key] ?? '').length).map((f) => f.label)
  if (missing.length > 0) {
    const out: TestOutcome = { ok: false, message: `Missing: ${missing.join(', ')}. Press Connect to finish setup.`, latencyMs: latency }
    await log(false, out.message)
    return out
  }
  const out: TestOutcome = {
    ok: true,
    message: `${spec.label} credentials verified — ${spec.fields.filter((f) => (saved[f.key] ?? '').length > 0).length} field(s) on file, formats valid.`,
    latencyMs: latency,
  }
  await log(true, out.message)
  return out
}
