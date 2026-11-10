/**
 * Seed the six named owners (Joshua, Vedant, Tanishq, Arghdeep, Shubham,
 * Devyani) into the demo organization, distribute leads & contacts among them
 * round-robin, and install an active round-robin Assignment Rule so new leads
 * are auto-assigned.
 *
 * Idempotent: users/memberships are upserted; distribution is deterministic
 * (sorted by createdAt) so re-running converges to the same state.
 *
 * Run: bun run scripts/seed-owners.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const OWNERS = [
  { name: 'Joshua', email: 'joshua@unstop.test' },
  { name: 'Vedant', email: 'vedant@unstop.test' },
  { name: 'Tanishq', email: 'tanishq@unstop.test' },
  { name: 'Arghdeep', email: 'arghdeep@unstop.test' },
  { name: 'Shubham', email: 'shubham@unstop.test' },
  { name: 'Devyani', email: 'devyani@unstop.test' },
]

const DEMO_PASSWORD = 'ZiaTest!2025'

async function hashPassword(plain: string): Promise<string> {
  const bcrypt = await import('bcryptjs')
  return bcrypt.hash(plain, 10)
}

async function main() {
  // 1. Resolve the demo org — prefer the Zia Data QA workspace, else the org
  //    of the zia-data user, else the first org.
  let org = await db.organization.findFirst({ where: { slug: 'zia-data-qa-s-workspace' } })
  if (!org) {
    const zia = await db.user.findFirst({ where: { email: 'zia-data@unstop.test' }, include: { memberships: true } })
    const orgId = zia?.memberships[0]?.organizationId
    org = orgId ? await db.organization.findUnique({ where: { id: orgId } }) : null
  }
  if (!org) org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!org) throw new Error('No organization found')
  console.log(`Org: ${org.name} (${org.id})`)

  // Admin user (fallback owner + rule fallback)
  const admin = await db.user.findFirst({
    where: { memberships: { some: { organizationId: org.id, isActive: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) throw new Error('No admin user in org')

  // 2. Ensure the six owner users exist (password = demo password).
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  const ownerIds: string[] = []
  for (const o of OWNERS) {
    const user = await db.user.upsert({
      where: { email: o.email },
      update: { name: o.name },
      create: { email: o.email, name: o.name, passwordHash },
    })
    ownerIds.push(user.id)
  }
  console.log(`Owners: ${OWNERS.map((o) => o.name).join(', ')}`)

  // 3. Ensure memberships (role: Member of this org, else any org role).
  const memberRole =
    (await db.role.findFirst({ where: { organizationId: org.id, name: 'Member' } })) ??
    (await db.role.findFirst({ where: { organizationId: org.id } }))
  if (!memberRole) throw new Error('No role found in org')
  for (const userId of ownerIds) {
    await db.tenantMembership.upsert({
      where: { userId_organizationId: { userId, organizationId: org.id } },
      update: { isActive: true, currentOrg: true },
      create: { userId, organizationId: org.id, roleId: memberRole.id, isActive: true, currentOrg: true },
    })
  }
  console.log(`Memberships ensured (role: ${memberRole.name}, currentOrg: true)`)

  // 4. Distribute leads & contacts round-robin (deterministic: createdAt, id).
  const leads = await db.lead.findMany({
    where: { organizationId: org.id, deletedAt: null },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  for (let i = 0; i < leads.length; i++) {
    await db.lead.update({ where: { id: leads[i].id }, data: { ownerId: ownerIds[i % ownerIds.length] } })
  }
  const contacts = await db.contact.findMany({
    where: { organizationId: org.id, deletedAt: null },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  for (let i = 0; i < contacts.length; i++) {
    await db.contact.update({ where: { id: contacts[i].id }, data: { ownerId: ownerIds[i % ownerIds.length] } })
  }
  console.log(`Distributed ${leads.length} leads + ${contacts.length} contacts round-robin`)

  // 5. Install an active round-robin assignment rule for leads (if none).
  const existing = await db.assignmentRule.findFirst({
    where: { organizationId: org.id, targetModel: 'lead', isActive: true },
  })
  if (!existing) {
    await db.assignmentRule.create({
      data: {
        organizationId: org.id,
        targetModel: 'lead',
        strategy: 'round_robin',
        criteria: '{}',
        assignTo: JSON.stringify(ownerIds),
        fallbackUserId: admin.id,
        isActive: true,
      },
    })
    console.log('Assignment rule created: leads → round robin across the six owners')
  } else {
    // Keep the rule pointed at the real owner ids.
    await db.assignmentRule.update({
      where: { id: existing.id },
      data: { assignTo: JSON.stringify(ownerIds), fallbackUserId: admin.id },
    })
    console.log('Assignment rule updated with the six owner ids')
  }

  // 6. Summary per owner.
  const leadCounts = await db.lead.groupBy({ by: ['ownerId'], where: { organizationId: org.id }, _count: true })
  const contactCounts = await db.contact.groupBy({ by: ['ownerId'], where: { organizationId: org.id }, _count: true })
  const names = await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
  const nameById = new Map(names.map((n) => [n.id, n.name]))
  for (const [id, name] of nameById) {
    const l = leadCounts.find((c) => c.ownerId === id)?._count ?? 0
    const c = contactCounts.find((c) => c.ownerId === id)?._count ?? 0
    console.log(`  ${name}: ${l} leads, ${c} contacts`)
  }

  // 7. Seed a few professional email templates for outreach (idempotent by name).
  const TEMPLATES = [
    {
      name: 'Intro — discovery call',
      subject: 'Quick intro — let’s find 15 minutes this week',
      bodyHtml: '<p>Hi {{first_name}},</p><p>I’m {{owner_name}} from Unstop. We help teams like {{company}} streamline their sales and success workflow end-to-end.</p><p>Would a 15-minute call this week work to explore whether this is relevant for your team?</p><p>Best regards,<br/>{{owner_name}}</p>',
      category: 'prospecting',
    },
    {
      name: 'Follow-up after demo',
      subject: 'Following up on our demo',
      bodyHtml: '<p>Hi {{first_name}},</p><p>Thank you for the time on the demo yesterday. As discussed, I’m sharing a quick recap of the points that matter most for {{company}}.</p><p>Happy to answer any open questions — shall we schedule a short follow-up with your team?</p><p>Best regards,<br/>{{owner_name}}</p>',
      category: 'follow-up',
    },
    {
      name: 'Quotation follow-up',
      subject: 'Your quotation from Unstop — any questions?',
      bodyHtml: '<p>Hi {{first_name}},</p><p>I wanted to check whether the quotation we shared reached you and whether anything needs clarification — pricing, implementation timeline, or support coverage.</p><p>If helpful, I can arrange a call with our solutions team this week.</p><p>Best regards,<br/>{{owner_name}}</p>',
      category: 'sales',
    },
  ]
  for (const t of TEMPLATES) {
    const existing = await db.emailTemplate.findFirst({ where: { organizationId: org.id, name: t.name } })
    if (!existing) await db.emailTemplate.create({ data: { organizationId: org.id, ...t } })
  }
  console.log(`Email templates ensured (${TEMPLATES.length})`)
  console.log('DONE')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
