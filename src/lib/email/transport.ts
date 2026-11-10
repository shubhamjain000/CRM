import nodemailer from 'nodemailer'

/**
 * Real SMTP delivery for outbound email.
 *
 * Configuration (environment variables):
 *   SMTP_HOST     — e.g. smtp.gmail.com / smtp.office365.com / smtp.resend.com
 *   SMTP_PORT     — default 587
 *   SMTP_SECURE   — 'true' for implicit TLS (465), default false (STARTTLS)
 *   SMTP_USER     — username
 *   SMTP_PASS     — password / app password / API key
 *   SMTP_FROM     — From header, e.g. "Unstop CRM <crm@yourdomain.com>"
 *
 * When SMTP_HOST is not set the platform does NOT pretend to send — messages
 * are stored as 'queued' and the inbox/job-runner reports them honestly.
 */
export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim())
}

export function smtpFromAddress(): string {
  return process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'crm@localhost'
}

export interface SmtpMessage {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  html: string
  text: string
  replyTo?: string
}

/** Send via SMTP. Returns the provider Message-Id. Throws on failure. */
export async function sendViaSmtp(msg: SmtpMessage): Promise<string> {
  const host = process.env.SMTP_HOST?.trim()
  if (!host) throw new Error('SMTP not configured (set SMTP_HOST)')

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: process.env.SMTP_USER?.trim()
      ? { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS ?? '' }
      : undefined,
    // Bounded handshake so a dead provider fails fast instead of hanging a request.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })

  const info = await transporter.sendMail({
    from: smtpFromAddress(),
    to: msg.to,
    cc: msg.cc?.length ? msg.cc : undefined,
    bcc: msg.bcc?.length ? msg.bcc : undefined,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    replyTo: msg.replyTo || undefined,
  })

  return info.messageId || ''
}
