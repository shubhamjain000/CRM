/**
 * Seed demo reports for the demo organization so the Reports builder shows real
 * saved reports on first visit. Idempotent: each report is upserted by
 * (organizationId, name), so user edits to the report config survive re-runs.
 *
 * Run: bun run scripts/seed-reports.ts
 */
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

interface Spec {
  name: string
  description: string
  sourceModel: string
  reportType: string
  chartType: string
  fields: { field: string }[]
  groupBy: string[]
  aggregates: { function: string; field: string; alias: string }[]
  filters: Record<string, unknown>
  limit: number
}

const SPECS: Spec[] = [
  {
    name: 'Deal Revenue by Stage',
    description: 'Pipeline value rolled up by deal stage — the core forecast chart.',
    sourceModel: 'deal',
    reportType: 'summary',
    chartType: 'bar',
    fields: [],
    groupBy: ['stageId'],
    aggregates: [
      { function: 'sum', field: 'amount', alias: 'sum_amount' },
      { function: 'count', field: 'id', alias: 'count_deals' },
    ],
    filters: {},
    limit: 100,
  },
  {
    name: 'Leads by Source',
    description: 'How new leads enter the funnel, broken down by lead source.',
    sourceModel: 'lead',
    reportType: 'summary',
    chartType: 'pie',
    fields: [],
    groupBy: ['leadSource'],
    aggregates: [{ function: 'count', field: 'id', alias: 'count_leads' }],
    filters: {},
    limit: 100,
  },
  {
    name: 'Open Deals',
    description: 'All active deals with their owner, amount and close date.',
    sourceModel: 'deal',
    reportType: 'tabular',
    chartType: 'none',
    fields: [
      { field: 'name' }, { field: 'amount' }, { field: 'stageId' },
      { field: 'closeDate' }, { field: 'ownerId' }, { field: 'probability' },
    ],
    groupBy: [],
    aggregates: [],
    filters: {},
    limit: 100,
  },
]

async function main() {
  const org = await db.organization.findFirst({
    where: { name: { contains: 'Zia Data QA' } },
  })
  if (!org) {
    console.error('Demo org "Zia Data QA" not found. Run scripts/seed-owners.ts first.')
    process.exit(1)
  }

  const admin = await db.user.findFirst({
    where: { email: 'zia-data@unstop.test' },
  })
  if (!admin) {
    console.error('Admin user zia-data@unstop.test not found.')
    process.exit(1)
  }

  console.log(`Seeding ${SPECS.length} reports for org "${org.name}"…`)
  let created = 0
  for (const spec of SPECS) {
    const existing = await db.report.findFirst({
      where: { organizationId: org.id, name: spec.name },
    })
    const payload = {
      organizationId: org.id,
      name: spec.name,
      description: spec.description,
      sourceModel: spec.sourceModel,
      reportType: spec.reportType,
      fields: JSON.stringify(spec.fields),
      filters: JSON.stringify(spec.filters),
      groupBy: JSON.stringify(spec.groupBy),
      aggregates: JSON.stringify(spec.aggregates),
      chartType: spec.chartType,
      chartConfig: '{}',
      limit: spec.limit,
      offset: 0,
      isActive: true,
      isPublished: false,
      createdById: admin.id,
    }
    if (existing) {
      await db.report.update({ where: { id: existing.id }, data: payload })
    } else {
      await db.report.create({ data: payload })
      created++
    }
    console.log(`  ${spec.name}: ${existing ? 'updated' : 'created'} (${spec.chartType})`)
  }

  console.log(`Created ${created} new report(s). DONE`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
