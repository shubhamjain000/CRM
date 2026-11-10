/**
 * Provider connect specs for the Ecosystem → Integrations tab.
 *
 * Every marketplace app that maps to a connector provider gets a guided
 * connection flow here: a numbered setup guide (the "steps"), the credential
 * fields to collect, and server-side validation so a connection only saves
 * when the credentials are present and well-formed.
 *
 * Secrets: fields with type "password" are redacted to "__SAVED__" whenever a
 * config leaves the server and restored on save (same semantics as the custom
 * API import feed in api-import.ts), so credentials never round-trip in clear.
 */

export const REDACTED = '__SAVED__'

export interface ProviderFieldSpec {
  key: string
  label: string
  type: 'text' | 'password'
  placeholder?: string
  required: boolean
  /** Short helper line under the input. */
  help?: string
}

export interface ProviderConnectSpec {
  provider: string
  label: string
  category: string
  /** One-liner under the dialog title. */
  tagline: string
  /** Numbered setup guide rendered inside the connect wizard. */
  steps: string[]
  fields: ProviderFieldSpec[]
  /** Where the user creates the credentials (opens in a new tab). */
  docsUrl?: string
  docsLabel?: string
}

export const PROVIDER_CONNECT_SPECS: Record<string, ProviderConnectSpec> = {
  google_workspace: {
    provider: 'google_workspace',
    label: 'Google Workspace',
    category: 'Productivity',
    tagline: 'Two-way Calendar sync, Gmail logging, Drive storage and Contacts mirroring.',
    steps: [
      'Open Google Cloud Console and create (or select) a project for this CRM.',
      'Enable the Calendar API, Gmail API and Drive API for that project.',
      'Go to APIs & Services → Credentials → Create credentials → OAuth client ID (Web application) and add this CRM to the authorized redirect URIs.',
      'Copy the Client ID and Client Secret, plus the Workspace admin email that will be impersonated for domain-wide delegation.',
    ],
    fields: [
      { key: 'clientId', label: 'OAuth Client ID', type: 'text', placeholder: '1234-abc.apps.googleusercontent.com', required: true, help: 'From APIs & Services → Credentials.' },
      { key: 'clientSecret', label: 'OAuth Client Secret', type: 'password', required: true },
      { key: 'adminEmail', label: 'Admin email (impersonation)', type: 'text', placeholder: 'admin@yourcompany.com', required: true, help: 'Workspace admin the sync acts as.' },
    ],
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    docsLabel: 'Google Cloud Console → Credentials',
  },
  slack: {
    provider: 'slack',
    label: 'Slack',
    category: 'Communication',
    tagline: 'Deal-won, lead-assigned and workflow alerts posted straight into Slack.',
    steps: [
      'Create a Slack app at api.slack.com/apps (From an app manifest is fastest).',
      'Under Incoming Webhooks, activate the feature and add a webhook for the channel that should receive CRM alerts.',
      'Copy the webhook URL (starts with https://hooks.slack.com/services/).',
      'Optional: copy the Bot User OAuth Token (xoxb-…) if you also want /unstop slash commands.',
    ],
    fields: [
      { key: 'webhookUrl', label: 'Incoming Webhook URL', type: 'text', placeholder: 'https://hooks.slack.com/services/T000/B000/XXXX', required: true },
      { key: 'botToken', label: 'Bot token (optional, for slash commands)', type: 'password', required: false, placeholder: 'xoxb-…' },
      { key: 'channel', label: 'Default channel', type: 'text', placeholder: '#sales', required: true },
    ],
    docsUrl: 'https://api.slack.com/apps',
    docsLabel: 'Slack → Your Apps',
  },
  zoom: {
    provider: 'zoom',
    label: 'Zoom',
    category: 'Communication',
    tagline: 'Schedule Zoom meetings from any deal or contact and archive recordings on the timeline.',
    steps: [
      'Go to marketplace.zoom.us → Develop → Build App and choose Server-to-Server OAuth.',
      'Copy the Account ID, Client ID and Client Secret from the app credentials page.',
      'Add the scopes your plan needs (meeting:write, recording:read, user:read).',
    ],
    fields: [
      { key: 'accountId', label: 'Account ID', type: 'text', required: true },
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
    ],
    docsUrl: 'https://marketplace.zoom.us/user/build',
    docsLabel: 'Zoom Marketplace → Build App',
  },
  quickbooks: {
    provider: 'quickbooks',
    label: 'QuickBooks',
    category: 'Accounting',
    tagline: 'Sync invoices and payment status onto deals and accounts.',
    steps: [
      'Create an app at developer.intuit.com and add the Accounting scope.',
      'Open Keys & credentials and copy the Client ID and Client Secret.',
      'In QuickBooks, press the ⚙️ icon → Account and settings; the Company ID (Realm ID) appears under Billing & subscription — copy it too.',
    ],
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      { key: 'realmId', label: 'Company ID (Realm ID)', type: 'text', required: true, help: 'Digits only, e.g. 1234567890123456789.' },
    ],
    docsUrl: 'https://developer.intuit.com/app/developer/dashboard',
    docsLabel: 'Intuit Developer Dashboard',
  },
  stripe: {
    provider: 'stripe',
    label: 'Stripe',
    category: 'Payments',
    tagline: 'Successful payments close deals; subscriptions and MRR sync to accounts.',
    steps: [
      'Open the Stripe Dashboard → Developers → API keys.',
      'Reveal (or create) a Secret key — use sk_test_… keys while evaluating, sk_live_… keys in production.',
      'Best practice: create a Restricted key (rk_…) limited to Charges, Invoices and Customers read access.',
    ],
    fields: [
      { key: 'secretKey', label: 'Secret key', type: 'password', placeholder: 'sk_test_… / sk_live_…', required: true },
      { key: 'publishableKey', label: 'Publishable key (optional)', type: 'text', placeholder: 'pk_live_…', required: false },
    ],
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    docsLabel: 'Stripe → API keys',
  },
  razorpay: {
    provider: 'razorpay',
    label: 'Razorpay',
    category: 'Payments',
    tagline: 'UPI, cards and netbanking payment links attached to deals (India).',
    steps: [
      'Log in to the Razorpay Dashboard.',
      'Go to Account & Settings → API Keys → Generate Test/Live Key.',
      'Copy the Key Id (rzp_test_… / rzp_live_…) and download or copy the Key Secret — it is shown only once.',
    ],
    fields: [
      { key: 'keyId', label: 'Key ID', type: 'text', placeholder: 'rzp_test_…', required: true },
      { key: 'keySecret', label: 'Key Secret', type: 'password', required: true },
    ],
    docsUrl: 'https://dashboard.razorpay.com/app/keys',
    docsLabel: 'Razorpay → API Keys',
  },
  docusign: {
    provider: 'docusign',
    label: 'DocuSign',
    category: 'E-signature',
    tagline: 'Send contracts for signature from a deal and archive the executed PDF.',
    steps: [
      'Open DocuSign eSignature → Settings → Apps and Keys.',
      'Add an app and copy the Integration Key (Client ID) and API Account ID.',
      'Copy the API Username (the User ID GUID) from the same page.',
    ],
    fields: [
      { key: 'integrationKey', label: 'Integration Key', type: 'text', required: true },
      { key: 'userId', label: 'API Username (User ID)', type: 'text', required: true, help: 'The GUID shown as API Username.' },
      { key: 'accountId', label: 'API Account ID', type: 'text', required: true },
    ],
    docsUrl: 'https://admindemo.docusign.com/apps-and-keys',
    docsLabel: 'DocuSign → Apps and Keys',
  },
  mailchimp: {
    provider: 'mailchimp',
    label: 'Mailchimp',
    category: 'Marketing',
    tagline: 'Keep Mailchimp audiences aligned with CRM contacts and attribute campaign engagement.',
    steps: [
      'In Mailchimp open your profile → Extras → API keys.',
      'Create an API key — it ends with a datacenter suffix like -us14.',
      'Paste the full key below; the datacenter is detected automatically.',
    ],
    fields: [
      { key: 'apiKey', label: 'API key', type: 'password', placeholder: 'xxxxxxxx-us14', required: true },
    ],
    docsUrl: 'https://us1.admin.mailchimp.com/account/api/',
    docsLabel: 'Mailchimp → API keys',
  },
  clearbit: {
    provider: 'clearbit',
    label: 'Clearbit',
    category: 'Enrichment',
    tagline: 'Auto-fill company size, industry and funding data on new leads and accounts.',
    steps: [
      'Log in to the Clearbit dashboard.',
      'Open the API keys section and copy your secret API key.',
    ],
    fields: [
      { key: 'apiKey', label: 'API key', type: 'password', required: true },
    ],
    docsUrl: 'https://dashboard.clearbit.com/keys',
    docsLabel: 'Clearbit → API keys',
  },
  hunter: {
    provider: 'hunter',
    label: 'Hunter.io',
    category: 'Enrichment',
    tagline: 'Find verified business emails from a name and company domain.',
    steps: [
      'Sign in at hunter.io and open the API tab in the dashboard.',
      'Copy your API key (free plan includes a monthly search quota).',
    ],
    fields: [
      { key: 'apiKey', label: 'API key', type: 'password', required: true },
    ],
    docsUrl: 'https://hunter.io/api-keys',
    docsLabel: 'Hunter.io → API keys',
  },
  calendly: {
    provider: 'calendly',
    label: 'Calendly',
    category: 'Scheduling',
    tagline: 'Booked Calendly meetings become CRM events and log attendance on the contact.',
    steps: [
      'Open Calendly → Integrations → API & Webhooks.',
      'Generate a new Personal Access Token (it is shown only once).',
      'Optional: note the webhook signing key if you plan to verify inbound events.',
    ],
    fields: [
      { key: 'personalAccessToken', label: 'Personal Access Token', type: 'password', required: true },
    ],
    docsUrl: 'https://calendly.com/integrations',
    docsLabel: 'Calendly → API & Webhooks',
  },
  zapier: {
    provider: 'zapier',
    label: 'Zapier',
    category: 'Automation',
    tagline: 'Trigger Zaps from CRM events and push actions into 5000+ apps.',
    steps: [
      'In Zapier, create a new Zap with the Webhooks by Zapier trigger, event Catch Hook.',
      'Copy the custom webhook URL Zapier generates for the trigger.',
      'Paste it below — CRM events will now fire that Zap; pair it with Zapier actions to write records back.',
    ],
    fields: [
      { key: 'hookUrl', label: 'Catch Hook URL', type: 'text', placeholder: 'https://hooks.zapier.com/hooks/catch/…', required: true },
    ],
    docsUrl: 'https://zapier.com/app/zaps',
    docsLabel: 'Zapier → Zaps',
  },
}

export function getProviderSpec(provider: string): ProviderConnectSpec | null {
  return PROVIDER_CONNECT_SPECS[provider] ?? null
}

/** Public shape sent to the client (no secrets involved — pure metadata). */
export function publicSpecs(): ProviderConnectSpec[] {
  return Object.values(PROVIDER_CONNECT_SPECS)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean
  /** Cleaned values (trimmed) when ok, undefined otherwise. */
  clean?: Record<string, string>
  error?: string
}

const MAX_VALUE_LENGTH = 2048

function firstIssue(provider: string, spec: ProviderConnectSpec, values: Record<string, string>): string | null {
  for (const f of spec.fields) {
    const v = (values[f.key] ?? '').trim()
    if (f.required && !v) return `${f.label} is required.`
  }
  const v = (k: string) => (values[k] ?? '').trim()
  switch (provider) {
    case 'stripe': {
      const sk = v('secretKey')
      if (sk && !/^[sr]k_(test|live)_/.test(sk)) return 'Stripe secret keys start with sk_test_, sk_live_ or rk_ — copy it from Dashboard → Developers → API keys.'
      const pk = v('publishableKey')
      if (pk && !/^pk_(test|live)_/.test(pk)) return 'Stripe publishable keys start with pk_test_ or pk_live_.'
      break
    }
    case 'razorpay': {
      const kid = v('keyId')
      if (kid && !/^rzp_(test|live)_/.test(kid)) return 'Razorpay Key IDs start with rzp_test_ or rzp_live_.'
      break
    }
    case 'slack': {
      const hook = v('webhookUrl')
      if (hook && !hook.startsWith('https://hooks.slack.com/')) return 'Slack incoming webhook URLs start with https://hooks.slack.com/.'
      const tok = v('botToken')
      if (tok && !tok.startsWith('xox')) return 'Slack bot tokens start with xox (usually xoxb-).'
      const ch = v('channel')
      if (ch && !/^[#@]?[\w.\- ]+$/.test(ch)) return 'Channel looks invalid — use a name like sales or #sales.'
      break
    }
    case 'mailchimp': {
      const key = v('apiKey')
      if (key && !/^[0-9a-f]{32}-us\d{1,2}$/i.test(key)) return 'Mailchimp API keys are 32 hex chars plus a datacenter suffix like -us14.'
      break
    }
    case 'zapier': {
      const hook = v('hookUrl')
      if (hook && !/^https:\/\/hooks\.zapier\.com\//.test(hook)) return 'Zapier catch-hook URLs start with https://hooks.zapier.com/.'
      break
    }
    case 'google_workspace': {
      const email = v('adminEmail')
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Admin email does not look like an email address.'
      break
    }
    case 'quickbooks': {
      const realm = v('realmId')
      if (realm && !/^\d{6,20}$/.test(realm.replace(/\s/g, ''))) return 'QuickBooks Company ID (Realm ID) is digits only — find it under Account and settings.'
      break
    }
    default:
      break
  }
  // Universal guards: values must fit the config column and secret fields
  // never carry whitespace (already stripped during merge).
  for (const f of spec.fields) {
    const val = v(f.key)
    if (val.length > MAX_VALUE_LENGTH) return `${f.label} is too long.`
  }
  return null
}

/**
 * Validate user-supplied connection values for a provider. `saved` carries the
 * previously stored (redacted) config so unchanged secret fields ("__SAVED__")
 * keep their stored value before validation runs.
 */
export function validateProviderValues(provider: string, values: Record<string, unknown>, saved?: Record<string, string>): ValidationResult {
  const spec = getProviderSpec(provider)
  if (!spec) return { ok: false, error: `No connect flow exists for "${provider}".` }
  const merged: Record<string, string> = {}
  for (const f of spec.fields) {
    const raw = values[f.key]
    let s = typeof raw === 'string' ? raw.trim() : ''
    if (s === REDACTED && saved && typeof saved[f.key] === 'string' && saved[f.key]) {
      s = saved[f.key] // keep the previously stored secret
    }
    if (f.type === 'password') s = s.replace(/\s+/g, '') // tokens never contain spaces
    merged[f.key] = s
  }
  const issue = firstIssue(provider, spec, merged)
  if (issue) return { ok: false, error: issue }
  return { ok: true, clean: merged }
}

// ---------------------------------------------------------------------------
// Redaction / secret merge (same "__SAVED__" semantics as api-import.ts)
// ---------------------------------------------------------------------------

/** Mask password-type fields before a config leaves the server. */
export function redactProviderConfig(provider: string, config: Record<string, unknown>): Record<string, unknown> {
  const spec = getProviderSpec(provider)
  if (!spec) return { ...config }
  const out: Record<string, unknown> = { ...config }
  for (const f of spec.fields) {
    if (f.type === 'password' && typeof out[f.key] === 'string' && (out[f.key] as string).length > 0) {
      out[f.key] = REDACTED
    }
  }
  return out
}

/** Parse an Integration.config JSON safely. */
export function parseProviderConfig(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const p: unknown = JSON.parse(raw)
    if (!p || typeof p !== 'object' || Array.isArray(p)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}
