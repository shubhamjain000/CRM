import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { parseCredentials, revokeGoogleToken } from '@/lib/email/google'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

// ---------------------------------------------------------------------------
// Email accounts
// ---------------------------------------------------------------------------

export async function listEmailAccounts() {
  const { tenant } = await ctx()
  return db.emailAccount.findMany({
    where: { organizationId: tenant.organization.id },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createEmailAccount(data: {
  provider: string
  emailAddress: string
  displayName?: string
  syncEnabled?: boolean
  syncFrequency?: number
  credentials?: Record<string, unknown>
}) {
  const { session, tenant } = await ctx()
  const acct = await db.emailAccount.create({
    data: {
      organizationId: tenant.organization.id,
      userId: session.userId,
      provider: data.provider,
      emailAddress: data.emailAddress,
      credentials: JSON.stringify(data.credentials ?? {}),
      syncEnabled: data.syncEnabled ?? true,
      syncFrequency: data.syncFrequency ?? 2,
      isActive: true,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'email_account.connect', targetType: 'email_account', targetId: acct.id,
    metadata: { provider: data.provider, emailAddress: data.emailAddress },
  })
  return acct
}

export async function deleteEmailAccount(id: string) {
  const { session, tenant } = await ctx()
  const existing = await db.emailAccount.findFirst({ where: { id, organizationId: tenant.organization.id } })
  if (!existing) throw new Error('Email account not found')
  // Part 6.5: OAuth Gmail connections are revoked at Google (best-effort) so
  // the refresh token can no longer be used anywhere else. App-password and
  // other accounts have nothing to revoke — removal behaves exactly as before.
  let revokeNote: string | undefined
  if (existing.provider === 'gmail' && existing.authMode === 'oauth') {
    try {
      const creds = parseCredentials(existing)
      if (creds.refreshToken) {
        const result = await revokeGoogleToken(creds.refreshToken)
        if (!result.revoked) revokeNote = result.error
      }
    } catch { /* never block the disconnect on revocation */ }
  }
  await db.emailAccount.delete({ where: { id } })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'email_account.disconnect', targetType: 'email_account', targetId: id,
    metadata: revokeNote ? { revokeError: revokeNote } : undefined,
  })
}

// ---------------------------------------------------------------------------
// WhatsApp Business accounts
// ---------------------------------------------------------------------------

export async function listWhatsAppAccounts() {
  const { tenant } = await ctx()
  return db.whatsAppAccount.findMany({
    where: { organizationId: tenant.organization.id },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createWhatsAppAccount(data: {
  displayName: string
  displayPhoneNumber: string
  wabaId: string
  phoneNumberId: string
  accessToken: string
}) {
  const { session, tenant } = await ctx()
  const acct = await db.whatsAppAccount.create({
    data: {
      organizationId: tenant.organization.id,
      displayName: data.displayName,
      displayPhoneNumber: data.displayPhoneNumber,
      wabaId: data.wabaId,
      phoneNumberId: data.phoneNumberId,
      accessToken: data.accessToken,
      isVerified: false,
      qualityRating: 'green',
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'whatsapp_account.connect', targetType: 'whatsapp_account', targetId: acct.id,
    metadata: { displayPhoneNumber: data.displayPhoneNumber },
  })
  return acct
}

export async function deleteWhatsAppAccount(id: string) {
  const { session, tenant } = await ctx()
  const existing = await db.whatsAppAccount.findFirst({ where: { id, organizationId: tenant.organization.id } })
  if (!existing) throw new Error('WhatsApp account not found')
  await db.whatsAppAccount.delete({ where: { id } })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'whatsapp_account.disconnect', targetType: 'whatsapp_account', targetId: id,
  })
}

export async function listWhatsAppTemplates() {
  const { tenant } = await ctx()
  return db.whatsAppTemplate.findMany({
    where: { organizationId: tenant.organization.id },
    orderBy: { createdAt: 'desc' },
  })
}

// ---------------------------------------------------------------------------
// Phone numbers (telephony)
// ---------------------------------------------------------------------------

export async function listPhoneNumbers() {
  const { tenant } = await ctx()
  return db.phoneNumber.findMany({
    where: { organizationId: tenant.organization.id },
    orderBy: { createdAt: 'desc' },
  })
}

export async function provisionPhoneNumber(data: {
  number: string
  provider: string
  capabilities?: { voice?: boolean; sms?: boolean; mms?: boolean; whatsapp?: boolean }
  region?: string
  friendlyName?: string
}) {
  const { session, tenant } = await ctx()
  const existing = await db.phoneNumber.findFirst({
    where: { organizationId: tenant.organization.id, number: data.number },
  })
  if (existing) throw new Error('That phone number is already provisioned')
  const pn = await db.phoneNumber.create({
    data: {
      organizationId: tenant.organization.id,
      number: data.number,
      provider: data.provider,
      capabilities: JSON.stringify(data.capabilities ?? { voice: true, sms: true }),
      region: data.region ?? 'IN',
      friendlyName: data.friendlyName ?? data.number,
      isActive: true,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'phone_number.provision', targetType: 'phone_number', targetId: pn.id,
    metadata: { number: data.number, provider: data.provider },
  })
  return pn
}

export async function releasePhoneNumber(id: string) {
  const { session, tenant } = await ctx()
  const existing = await db.phoneNumber.findFirst({ where: { id, organizationId: tenant.organization.id } })
  if (!existing) throw new Error('Phone number not found')
  await db.phoneNumber.update({ where: { id }, data: { isActive: false } })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'phone_number.release', targetType: 'phone_number', targetId: id,
  })
}

// ---------------------------------------------------------------------------
// Integrations (extends ecosystem/handler with config + credentials)
// ---------------------------------------------------------------------------

export interface IntegrationDef {
  provider: string
  name: string
  category: string
  description: string
  /** Field schema for the connect form. */
  fields: { key: string; label: string; type: 'text' | 'password'; placeholder?: string; required?: boolean }[]
}

export const INTEGRATION_CATALOG: IntegrationDef[] = [
  {
    provider: 'gmail', name: 'Gmail', category: 'Email', description: 'Sync inbox, send as any Gmail address.',
    fields: [
      { key: 'email', label: 'Email address', type: 'text', placeholder: 'you@company.com', required: true },
      { key: 'clientId', label: 'OAuth Client ID', type: 'text', placeholder: 'xxxxx.apps.googleusercontent.com', required: true },
      { key: 'clientSecret', label: 'OAuth Client Secret', type: 'password', required: true },
      { key: 'refreshToken', label: 'Refresh Token', type: 'password', required: true },
    ],
  },
  {
    provider: 'outlook', name: 'Outlook / Office 365', category: 'Email', description: 'Connect a Microsoft 365 mailbox.',
    fields: [
      { key: 'email', label: 'Email address', type: 'text', placeholder: 'you@company.com', required: true },
      { key: 'clientId', label: 'Application (client) ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client secret', type: 'password', required: true },
      { key: 'tenantId', label: 'Directory (tenant) ID', type: 'text', required: true },
    ],
  },
  {
    provider: 'whatsapp', name: 'WhatsApp Business', category: 'Messaging', description: 'Send WhatsApp messages via the Business API.',
    fields: [
      { key: 'wabaId', label: 'WABA ID', type: 'text', required: true },
      { key: 'phoneNumberId', label: 'Phone Number ID', type: 'text', required: true },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true },
    ],
  },
  {
    provider: 'twilio', name: 'Twilio', category: 'Telephony', description: 'Voice + SMS via Twilio.',
    fields: [
      { key: 'accountSid', label: 'Account SID', type: 'text', required: true },
      { key: 'authToken', label: 'Auth Token', type: 'password', required: true },
      { key: 'fromNumber', label: 'From number', type: 'text', placeholder: '+91…', required: true },
    ],
  },
  {
    provider: 'msg91', name: 'MSG91', category: 'Telephony', description: 'India-focused SMS & OTP gateway.',
    fields: [
      { key: 'authKey', label: 'Auth Key', type: 'password', required: true },
      { key: 'senderId', label: 'Sender ID', type: 'text', placeholder: 'UNSTOP', required: true },
    ],
  },
  {
    provider: 'slack', name: 'Slack', category: 'Notifications', description: 'Pipe CRM alerts into Slack channels.',
    fields: [
      { key: 'webhookUrl', label: 'Incoming Webhook URL', type: 'text', placeholder: 'https://hooks.slack.com/…', required: true },
      { key: 'channel', label: 'Channel', type: 'text', placeholder: '#sales', required: true },
    ],
  },
  {
    provider: 'zoom', name: 'Zoom', category: 'Meetings', description: 'Create Zoom meetings from records.',
    fields: [
      { key: 'accountId', label: 'Account ID', type: 'text', required: true },
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
    ],
  },
  {
    provider: 'razorpay', name: 'Razorpay', category: 'Payments', description: 'UPI, cards, netbanking (India).',
    fields: [
      { key: 'keyId', label: 'Key ID', type: 'text', required: true },
      { key: 'keySecret', label: 'Key Secret', type: 'password', required: true },
    ],
  },
  {
    provider: 'stripe', name: 'Stripe', category: 'Payments', description: 'Global card payments.',
    fields: [
      { key: 'publishableKey', label: 'Publishable key', type: 'text', required: true },
      { key: 'secretKey', label: 'Secret key', type: 'password', required: true },
    ],
  },
]

export async function listIntegrationsWithConfig() {
  const { tenant } = await ctx()
  return db.integration.findMany({
    where: { organizationId: tenant.organization.id },
    orderBy: { createdAt: 'desc' },
  })
}

export async function connectIntegrationWithConfig(provider: string, config: Record<string, unknown>) {
  const { session, tenant } = await ctx()
  const def = INTEGRATION_CATALOG.find((d) => d.provider === provider)
  if (!def) throw new Error(`Unknown provider: ${provider}`)
  // Validate required fields.
  for (const f of def.fields) {
    if (f.required && !config[f.key]) throw new Error(`${f.label} is required`)
  }
  const integration = await db.integration.upsert({
    where: { organizationId_provider: { organizationId: tenant.organization.id, provider } },
    create: {
      organizationId: tenant.organization.id,
      provider,
      isConnected: true,
      config: JSON.stringify(config),
    },
    update: { isConnected: true, config: JSON.stringify(config) },
  })
  await db.integrationLog.create({
    data: {
      organizationId: tenant.organization.id,
      integrationId: integration.id,
      event: 'connected',
      status: 'info',
      details: `Connected ${def.name} (${provider})`,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'integration.connect', targetType: 'integration', targetId: integration.id,
    metadata: { provider },
  })
  return integration
}

export async function disconnectIntegrationClean(provider: string) {
  const { session, tenant } = await ctx()
  const integration = await db.integration.findUnique({
    where: { organizationId_provider: { organizationId: tenant.organization.id, provider } },
  })
  if (!integration) return
  await db.integration.update({
    where: { id: integration.id },
    data: { isConnected: false, config: '{}' },
  })
  await db.integrationLog.create({
    data: {
      organizationId: tenant.organization.id,
      integrationId: integration.id,
      event: 'disconnected',
      status: 'info',
      details: `Disconnected ${provider}`,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'integration.disconnect', targetType: 'integration', targetId: integration.id,
    metadata: { provider },
  })
}

export async function listIntegrationLogs(limit = 25) {
  const { tenant } = await ctx()
  return db.integrationLog.findMany({
    where: { organizationId: tenant.organization.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}
