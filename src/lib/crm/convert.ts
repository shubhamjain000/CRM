import { db } from '@/lib/db'
import { audit } from '@/lib/auth/audit'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'

/**
 * Convert a lead into an Account + Contact + Deal (the classic CRM conversion flow).
 * - Creates an Account from the lead's company info
 * - Creates a Contact from the lead's person info, linked to the account
 * - Creates a Deal on the default pipeline's first stage, linked to both
 * - Marks the lead as converted with the three FKs set
 */
export async function convertLead(leadId: string): Promise<{
  accountId: string
  contactId: string
  dealId: string
}> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')

  // Tenant-scoped: prevents converting another organization's lead by id
  const lead = await db.lead.findFirst({
    where: { id: leadId, organizationId: tenant.organization.id, deletedAt: null },
    include: { convertedAccount: true, convertedContact: true, convertedDeal: true },
  })
  if (!lead) throw new Error('Lead not found')
  if (lead.isConverted) {
    return {
      accountId: lead.convertedAccountId!,
      contactId: lead.convertedContactId!,
      dealId: lead.convertedDealId!,
    }
  }

  // Default pipeline + first open stage
  const pipeline = await db.pipeline.findFirst({
    where: { organizationId: lead.organizationId, isDefault: true },
    include: { stages: { orderBy: { order: 'asc' }, take: 1 } },
  }) ?? await db.pipeline.findFirst({
    where: { organizationId: lead.organizationId },
    include: { stages: { orderBy: { order: 'asc' }, take: 1 } },
  })
  const firstStage = pipeline?.stages[0]
  if (!pipeline || !firstStage) {
    throw new Error('No pipeline/stage configured for this organization')
  }

  const result = await db.$transaction(async (tx) => {
    // 1. Account
    const account = await tx.account.create({
      data: {
        organizationId: lead.organizationId,
        name: lead.company ?? `${lead.firstName} ${lead.lastName}`,
        industry: lead.industry,
        annualRevenue: lead.annualRevenue,
        employees: lead.employees,
        website: lead.website,
        billingAddress: lead.billingAddress,
        shippingAddress: lead.shippingAddress,
        ownerId: lead.ownerId,
        accountType: 'customer',
        rating: lead.rating,
      },
    })

    // 2. Contact
    const contact = await tx.contact.create({
      data: {
        organizationId: lead.organizationId,
        firstName: lead.firstName,
        lastName: lead.lastName,
        accountId: account.id,
        title: lead.title,
        emails: lead.emails,
        phones: lead.phones,
        leadSource: lead.leadSource,
        ownerId: lead.ownerId,
      },
    })

    // 3. Deal
    const dealName = `${lead.company ?? lead.firstName + ' ' + lead.lastName} — Deal`
    const deal = await tx.deal.create({
      data: {
        organizationId: lead.organizationId,
        name: dealName,
        amount: lead.annualRevenue ? lead.annualRevenue * 0.1 : 0,
        currency: 'INR',
        stageId: firstStage.id,
        pipelineId: pipeline.id,
        closeDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        probability: firstStage.probability,
        accountId: account.id,
        primaryContactId: contact.id,
        ownerId: lead.ownerId,
        leadSource: lead.leadSource,
        type: 'new_business',
        nextStep: 'Discovery call',
      },
    })

    // Link deal-contact M2M
    await tx.dealContact.create({
      data: { dealId: deal.id, contactId: contact.id, role: 'primary' },
    })

    // 4. Mark lead converted
    const updated = await tx.lead.update({
      where: { id: leadId },
      data: {
        isConverted: true,
        leadStatus: 'converted',
        convertedAccountId: account.id,
        convertedContactId: contact.id,
        convertedDealId: deal.id,
        lastActivity: new Date(),
      },
    })
    return { account, contact, deal, updated }
  })

  await audit({
    organizationId: tenant.organization.id,
    actorId: session.userId,
    action: 'lead.convert',
    targetType: 'lead',
    targetId: leadId,
    metadata: {
      accountId: result.account.id,
      contactId: result.contact.id,
      dealId: result.deal.id,
    },
  })

  return {
    accountId: result.account.id,
    contactId: result.contact.id,
    dealId: result.deal.id,
  }
}

/**
 * Ensure an organization has a default pipeline + stages. Called during
 * org provisioning and during seed.
 */
export async function ensureDefaultPipeline(organizationId: string): Promise<string> {
  const existing = await db.pipeline.findFirst({
    where: { organizationId, isDefault: true },
  })
  if (existing) return existing.id

  const pipeline = await db.pipeline.create({
    data: {
      organizationId,
      name: 'Sales Pipeline',
      isDefault: true,
      order: 0,
      stages: {
        create: [
          { organizationId, name: 'Prospect', probability: 10, order: 0 },
          { organizationId, name: 'Qualified', probability: 25, order: 1 },
          { organizationId, name: 'Proposal', probability: 50, order: 2 },
          { organizationId, name: 'Negotiation', probability: 75, order: 3 },
          { organizationId, name: 'Closed Won', probability: 100, order: 4, isWonStage: true, isClosed: true },
          { organizationId, name: 'Closed Lost', probability: 0, order: 5, isLostStage: true, isClosed: true },
        ],
      },
    },
    include: { stages: true },
  })
  return pipeline.id
}
