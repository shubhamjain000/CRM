// Shared template metadata for the Platform Settings → Templates tab.
//
// Imported by BOTH the API route handlers (src/app/api/templates/**) and the
// template editor UI, so "Reset to Default" has a single source of truth
// without touching the Prisma schema: a template is treated as a seeded
// "system" template when its (case-sensitive) name appears in one of the
// default maps below. Everything else is a user-created custom template.

export type TemplateKind = 'email' | 'pdf'

export interface TemplateDefault {
  subject?: string
  body: string
}

// Merge tags offered by the editor's "Insert variable" toolbar and resolved
// by the Preview and the compose-email merge-field substitution. Any other
// {{token}} is deliberately left untouched by the substitution helper.
export const TEMPLATE_VARIABLES = [
  'first_name', 'last_name', 'full_name', 'email', 'phone', 'company',
  'owner_name', 'owner_email', 'date',
] as const
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]

// Sanitisation limits shared by the PATCH endpoints and the editor UI.
export const MAX_TEMPLATE_NAME_LENGTH = 120
export const MAX_TEMPLATE_SUBJECT_LENGTH = 500
export const MAX_TEMPLATE_BODY_LENGTH = 50_000

// Mirrors the outreach templates seeded by scripts/seed-owners.ts (the only
// place system email templates are created), keyed by template name.
const EMAIL_TEMPLATE_DEFAULTS: Record<string, TemplateDefault> = {
  'Intro — discovery call': {
    subject: 'Quick intro — let’s find 15 minutes this week',
    body: '<p>Hi {{first_name}},</p><p>I’m {{owner_name}} from Unstop. We help teams like {{company}} streamline their sales and success workflow end-to-end.</p><p>Would a 15-minute call this week work to explore whether this is relevant for your team?</p><p>Best regards,<br/>{{owner_name}}</p>',
  },
  'Follow-up after demo': {
    subject: 'Following up on our demo',
    body: '<p>Hi {{first_name}},</p><p>Thank you for the time on the demo yesterday. As discussed, I’m sharing a quick recap of the points that matter most for {{company}}.</p><p>Happy to answer any open questions — shall we schedule a short follow-up with your team?</p><p>Best regards,<br/>{{owner_name}}</p>',
  },
  'Quotation follow-up': {
    subject: 'Your quotation from Unstop — any questions?',
    body: '<p>Hi {{first_name}},</p><p>I wanted to check whether the quotation we shared reached you and whether anything needs clarification — pricing, implementation timeline, or support coverage.</p><p>If helpful, I can arrange a call with our solutions team this week.</p><p>Best regards,<br/>{{owner_name}}</p>',
  },
}

// No PDF templates are seeded today; the map exists so the same Reset
// machinery applies if seeded PDF templates are introduced later.
const PDF_TEMPLATE_DEFAULTS: Record<string, TemplateDefault> = {}

/** Returns the seeded default for a template name, or null for custom ones. */
export function getTemplateDefault(kind: TemplateKind, name: string): TemplateDefault | null {
  const map = kind === 'email' ? EMAIL_TEMPLATE_DEFAULTS : PDF_TEMPLATE_DEFAULTS
  return Object.prototype.hasOwnProperty.call(map, name) ? { ...map[name] } : null
}

/** True when the template name matches a seeded system template. */
export function hasTemplateDefault(kind: TemplateKind, name: string): boolean {
  return getTemplateDefault(kind, name) !== null
}

// Sample values used by the editor's Preview. {{date}} is evaluated lazily at
// call time so an open editor always shows "today".
export function sampleTemplateValues(): Record<TemplateVariable, string> {
  return {
    first_name: 'Priya',
    last_name: 'Sharma',
    full_name: 'Priya Sharma',
    email: 'priya@acme.test',
    phone: '+91 98200 12345',
    company: 'Acme Corp',
    owner_name: 'Zia Data QA',
    owner_email: 'owner@unstop.test',
    date: new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
  }
}

/** Replaces {{known}} tokens with `values`; unknown tokens stay as-is. */
export function substituteTemplateVariables(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  )
}
