import { NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { hasPermission } from '@/lib/auth/permissions'
import { db } from '@/lib/db'
import { audit } from '@/lib/auth/audit'
import { hashPassword } from '@/lib/auth/password'
import { provisionOrganization, slugify } from '@/lib/auth/provisioning'
import { smtpConfigured, sendViaSmtp } from '@/lib/email/transport'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await getTenant(session.userId)
  if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

  const memberships = await db.tenantMembership.findMany({
    where: { organizationId: tenant.organization.id, isActive: true },
    include: { user: true, role: true },
    orderBy: { joinedAt: 'asc' },
  })

  const users = await Promise.all(
    memberships.map(async (m) => {
      const lastLogin = await db.loginHistory.findFirst({
        where: { userId: m.userId, organizationId: tenant.organization.id, success: true },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      return {
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        isSuperuser: m.user.isSuperuser, // additive — lets the UI hide destructive actions
        role: m.role.name,
        roleId: m.roleId,
        status: m.isActive ? 'active' : 'suspended',
        lastActive: lastLogin?.createdAt ?? m.joinedAt,
      }
    }),
  )

  return NextResponse.json({ users })
}

// ---------------------------------------------------------------------------
// User type → role mapping for the add-user form. Roles are organization-
// scoped (see provisionOrganization for the canonical permissions format: a
// JSON string array). When the org has no role matching the selected user
// type we create one on demand with a sensible permission set.
// ---------------------------------------------------------------------------
const USER_TYPES = ['Admin', 'Manager', 'Agent', 'Viewer'] as const
type UserType = (typeof USER_TYPES)[number]

const USER_TYPE_PERMISSIONS: Record<UserType, string[]> = {
  Admin: ['*'],
  Manager: ['manage_records', 'manage_rules', 'use_ai_templates'],
  Agent: ['manage_records'],
  Viewer: ['view_records'],
}

const USER_TYPE_DESCRIPTIONS: Record<UserType, string> = {
  Admin: 'Full platform control — users, connectors, import/export, AI templates.',
  Manager: 'Run the CRM — AI templates, rules and all record operations.',
  Agent: 'Day-to-day selling — records, notes, tasks and outreach.',
  Viewer: 'Read-only visibility into records and dashboards.',
}

/** CSPRNG password (12 chars, A-Za-z0-9) for auto-generated invites. */
function generateInvitePassword(length = 12): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)]
  return out
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenant = await getTenant(session.userId)
  if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

  if (!(await hasPermission(tenant.role.id, 'users.manage'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.email || !body?.name) {
    return NextResponse.json({ error: 'Missing email or name' }, { status: 400 })
  }

  const email = String(body.email).toLowerCase().trim()

  // Resolve the target role: from the selected user type (find-or-create an
  // organization-scoped role with that exact name), or — for legacy callers —
  // from an explicit roleId.
  let role: { id: string; name: string } | null = null
  const userType = typeof body.userType === 'string' ? (body.userType as UserType) : null
  if (userType && (USER_TYPES as readonly string[]).includes(userType)) {
    role = await db.role.findFirst({
      where: { organizationId: tenant.organization.id, name: userType },
      select: { id: true, name: true },
    })
    if (!role) {
      role = await db.role.create({
        data: {
          organizationId: tenant.organization.id,
          name: userType,
          description: USER_TYPE_DESCRIPTIONS[userType],
          permissions: JSON.stringify(USER_TYPE_PERMISSIONS[userType]),
        },
        select: { id: true, name: true },
      })
    }
  } else if (body.roleId) {
    role = await db.role.findFirst({
      where: { id: String(body.roleId), organizationId: tenant.organization.id },
      select: { id: true, name: true },
    })
  }
  if (!role) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  // Password: use the admin-supplied one when present (min 8 chars — enforced
  // inline in the UI), otherwise auto-generate a 12-char throwaway.
  const requestedPassword = typeof body.password === 'string' ? body.password : ''
  if (requestedPassword && requestedPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }
  const password = requestedPassword || generateInvitePassword()

  // Find or create user
  let isNewUser = false
  let user = await db.user.findUnique({ where: { email } })
  if (!user) {
    isNewUser = true
    const passwordHash = await hashPassword(password)
    user = await db.user.create({
      data: {
        email,
        name: String(body.name),
        passwordHash,
        profile: { create: {} },
        passwordHistory: { create: { passwordHash } }, // mirror signup convention
      },
    })
  }

  const existing = await db.tenantMembership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId: tenant.organization.id } },
  })
  if (existing) {
    return NextResponse.json({ error: 'User already a member' }, { status: 409 })
  }

  await db.tenantMembership.create({
    data: {
      userId: user.id,
      organizationId: tenant.organization.id,
      roleId: role.id,
    },
  })

  // In-app "Welcome" notification for the new member (best-effort).
  try {
    await db.notification.create({
      data: {
        organizationId: tenant.organization.id,
        actorId: session.userId,
        verb: 'invited',
        targetModule: 'users',
        targetId: user.id,
        targetName: `Welcome to ${tenant.organization.name}`,
        recipientId: user.id,
        channel: 'in_app',
        data: JSON.stringify({
          message: `Welcome to ${tenant.organization.name}`,
          role: role.name,
          invitedBy: session.name,
        }),
      },
    })
  } catch (e) {
    console.error('[users.invite] welcome notification failed (non-fatal)', e)
  }

  // Invitation email — best-effort. SMTP is usually unconfigured in the
  // sandbox, so a failure (or missing SMTP_HOST) must NOT fail the invite:
  // the UI falls back to a "share credentials" panel instead.
  const credentials: { email: string; password: string | null } = {
    email: user.email,
    // A pre-existing platform account keeps its own password — only brand-new
    // users receive the password chosen/generated here.
    password: isNewUser ? password : null,
  }
  let emailSent = false
  if (smtpConfigured()) {
    try {
      const orgName = tenant.organization.name
      const origin =
        typeof body.clientUrl === 'string' && body.clientUrl.trim()
          ? body.clientUrl.trim().replace(/\/+$/, '')
          : ''
      const loginUrl = origin ? `${origin}/login` : '/login'
      const credentialsHtml = credentials.password
        ? `<p style="margin:0 0 8px"><strong>Email:</strong> ${escapeHtml(credentials.email)}<br/><strong>Password:</strong> <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${escapeHtml(credentials.password)}</code></p>`
        : `<p style="margin:0 0 8px"><strong>Email:</strong> ${escapeHtml(credentials.email)}<br/><em>You already have an Unstop CRM account — sign in with your existing password.</em></p>`
      await sendViaSmtp({
        to: [user.email],
        subject: `You've been invited to ${orgName} on Unstop CRM`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px"><h2 style="margin:0 0 12px">You've been invited to ${escapeHtml(orgName)} on Unstop CRM</h2><p style="margin:0 0 8px">Hi ${escapeHtml(user.name)},</p><p style="margin:0 0 12px">You have been added as <strong>${escapeHtml(role.name)}</strong>. Sign in here:</p><p style="margin:0 0 12px"><a href="${loginUrl}">${loginUrl}</a></p>${credentialsHtml}<p style="margin:16px 0 0;color:#64748b;font-size:12px">If you were not expecting this invitation you can ignore this email.</p></div>`,
        text: `You've been invited to ${orgName} on Unstop CRM as ${role.name}. Sign in: ${loginUrl} — Email: ${credentials.email}${credentials.password ? ` — Password: ${credentials.password}` : ' (use your existing password)'}`,
      })
      emailSent = true
    } catch (e) {
      console.error('[users.invite] invitation email failed (non-fatal)', e)
      emailSent = false
    }
  }

  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: 'user.invite',
    targetType: 'user',
    targetId: user.id,
    ip: req.headers.get('x-forwarded-for') || null,
    userAgent: req.headers.get('user-agent') || null,
    metadata: { email, role: role.name, userType: role.name, emailSent },
  })

  // `emailSent` + `credentials` are additive fields: when the invitation email
  // could not be delivered the UI shows them for manual sharing.
  return NextResponse.json({ ok: true, userId: user.id, emailSent, credentials })
}
