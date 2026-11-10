import { NextResponse } from 'next/server'
import { listTenant } from '@/lib/crm/handler'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { hasPermission } from '@/lib/auth/permissions'
import { audit } from '@/lib/auth/audit'
import { maskRecordsForRead, getFieldRulesForRole } from '@/lib/auth/field-security'
import { safeJsonParseList } from './csv'

export const dynamic = 'force-dynamic'

const MAX_EXPORT_ROWS = 10000

const COLUMNS: Record<string, string[]> = {
  lead: ['firstName', 'lastName', 'company', 'title', 'leadStatus', 'rating', 'score', 'leadSource', 'industry', 'website', 'annualRevenue', 'employees', 'emails', 'phones', 'description', 'createdAt'],
  contact: ['firstName', 'lastName', 'title', 'department', 'leadSource', 'emails', 'phones', 'accountId', 'description', 'createdAt',
    // Listing Intelligence (additive — appended after the existing columns,
    // original column order untouched)
    'recruiterTag', 'premiumStatus', 'listingSubtype', 'totalApplications',
    'reasonableFitPct', 'reasonableScoreUsers', 'listingUrl', 'listingTitle',
    'listingCategory', 'dateApproved'],
  account: ['name', 'accountNumber', 'accountType', 'industry', 'website', 'annualRevenue', 'employees', 'rating', 'ownership', 'createdAt'],
  deal: ['name', 'amount', 'currency', 'type', 'leadSource', 'probability', 'closeDate', 'nextStep', 'accountId', 'description', 'createdAt'],
}

const HEADERS: Record<string, string> = {
  firstName: 'First Name', lastName: 'Last Name', company: 'Company', title: 'Title',
  leadStatus: 'Lead Status', rating: 'Rating', score: 'Score', leadSource: 'Lead Source',
  industry: 'Industry', website: 'Website', annualRevenue: 'Annual Revenue', employees: 'Employees',
  emails: 'Emails', phones: 'Phones', description: 'Description', createdAt: 'Created',
  department: 'Department', accountId: 'Account ID', name: 'Name', accountNumber: 'Account Number',
  accountType: 'Account Type', ownership: 'Ownership', amount: 'Amount', currency: 'Currency',
  type: 'Deal Type', probability: 'Probability (%)', closeDate: 'Close Date', nextStep: 'Next Step',
  // Listing Intelligence (contact export)
  recruiterTag: 'Recruiter Tag', premiumStatus: 'Premium Status', listingSubtype: 'Listing Subtype',
  totalApplications: 'Total Applications', reasonableFitPct: 'Reasonable Fit %',
  reasonableScoreUsers: 'Reasonable Score Users', listingUrl: 'Listing URL',
  listingTitle: 'Listing Title', listingCategory: 'Listing Category', dateApproved: 'Date Approved',
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenant = await getTenant(session.userId)
    if (!tenant) return NextResponse.json({ error: 'No organization' }, { status: 403 })

    const url = new URL(req.url)
    const moduleName = url.searchParams.get('module') ?? ''
    const format = (url.searchParams.get('format') ?? 'csv').toLowerCase()
    if (!COLUMNS[moduleName]) return NextResponse.json({ error: 'Unknown module' }, { status: 400 })
    if (!['csv', 'json', 'pdf', 'docx'].includes(format)) return NextResponse.json({ error: 'Unsupported format' }, { status: 400 })

    // Reuse the same tenant-scoped list pipeline (search + filters + sort supported)
    const params = {
      search: url.searchParams.get('search') ?? undefined,
      sort: url.searchParams.get('sort') ?? undefined,
      limit: 200,
      filters: Object.fromEntries(url.searchParams.entries()) as Record<string, string>,
    }
    // Reserved query keys are NOT column filters — `sort` in the where clause
    // made Prisma throw `Unknown argument 'sort'` (the export regression).
    const RESERVED = new Set(['module', 'format', 'sort', 'search', 'limit', 'cursor', 'page'])
    for (const key of Object.keys(params.filters)) {
      if (RESERVED.has(key)) delete (params.filters as Record<string, unknown>)[key]
    }

    // Cursor-loop up to MAX_EXPORT_ROWS
    const all: Record<string, unknown>[] = []
    let cursor: string | undefined
    for (let page = 0; page < Math.ceil(MAX_EXPORT_ROWS / 200); page++) {
      const res = await listTenant<{ id: string; createdAt: Date; [key: string]: unknown }>(moduleName as 'lead' | 'contact' | 'account' | 'deal', { ...params, cursor })
      all.push(...res.items)
      if (!res.nextCursor || all.length >= MAX_EXPORT_ROWS) break
      cursor = res.nextCursor
    }

    // Field-level security: exports honor the caller's role exactly like list
    // reads — hidden fields are stripped from every row AND dropped as columns
    // entirely (they never appear as empty cells). Admins bypass; no rules
    // configured → records and columns are untouched.
    const admin = await hasPermission(tenant.role.id, 'org.admin')
    const masked = await maskRecordsForRead(moduleName, all, tenant.role.id)
    let cols = COLUMNS[moduleName]
    if (!admin) {
      const rules = await getFieldRulesForRole(tenant.role.id)
      const hidden = new Set(
        Object.entries(rules[moduleName] ?? {})
          .filter(([, level]) => level === 'hidden')
          .map(([field]) => field),
      )
      if (hidden.size > 0) cols = cols.filter((c) => !hidden.has(c))
    }

    await audit({
      organizationId: tenant.organization.id,
      actorId: session.userId,
      action: `${moduleName}.export`,
      targetType: moduleName,
      metadata: { format, rows: masked.length },
    })

    const stamp = new Date().toISOString().slice(0, 10)
    const filename = `${moduleName}s-${stamp}.${format}`

    if (format === 'json') {
      return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), module: moduleName, count: masked.length, records: masked }, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    const headerRow = cols.map((c) => HEADERS[c] ?? c)
    const rows: string[][] = []
    for (const rec of masked) {
      rows.push(cols.map((c) => {
        const raw = rec[c]
        if (c === 'emails' || c === 'phones') return safeJsonParseList(raw).join('; ')
        // listingCategory is stored as a JSON-array string → join with "; "
        // (falls back to the raw string for legacy/non-JSON values).
        if (c === 'listingCategory') {
          const list = safeJsonParseList(raw)
          if (list.length > 0) return list.join('; ')
          return raw === null || raw === undefined ? '' : String(raw)
        }
        if (c === 'createdAt' || c === 'closeDate' || c === 'dateApproved') return raw ? new Date(raw as string).toISOString().slice(0, 10) : ''
        return raw === null || raw === undefined ? '' : String(raw)
      }))
    }

    if (format === 'pdf') {
      const blob = await exportPdf(moduleName, headerRow, rows, all.length)
      return new NextResponse(blob, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    if (format === 'docx') {
      const blob = await exportDocx(moduleName, headerRow, rows, all.length)
      return new NextResponse(blob, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    // CSV fallback
    const lines = [headerRow.join(',')]
    for (const cells of rows) {
      lines.push(cells.map(csvEscape).join(','))
    }
    // \uFEFF BOM makes Excel open UTF-8 CSV correctly
    const csv = '\uFEFF' + lines.join('\r\n')

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    const status = e instanceof Error && e.message === 'Unauthorized' ? 401
      : e instanceof Error && e.message === 'No organization' ? 403 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status })
  }
}

// ---------------------------------------------------------------------------
// PDF + DOCX generators (server-side, dynamic imports keep them out of any
// other route's bundle). Style mirrors src/lib/invoice-docs.ts: navy header
// band, A4, Helvetica with safe ASCII money formatting.
// ---------------------------------------------------------------------------

const NAVY: [number, number, number] = [34, 53, 88]
const NAVY_HEX = '223558'
const COMPANY = 'Unstop CRM Platform'

const MODULE_LABEL: Record<string, string> = {
  lead: 'Leads',
  contact: 'Contacts',
  account: 'Accounts',
  deal: 'Deals',
}

async function exportPdf(
  moduleName: string,
  header: string[],
  rows: string[][],
  count: number,
): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 36
  const label = MODULE_LABEL[moduleName] ?? moduleName

  // Header band
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 60, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(`${label} Export`, M, 28)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(199, 210, 229)
  doc.text(COMPANY, M, 46)
  doc.text(`${count} records · ${new Date().toLocaleString('en-IN')}`, W - M, 30, { align: 'right' })

  // Table
  const tableTop = 80
  const rowH = 18
  const colW = (W - M * 2) / header.length

  // Header row
  doc.setFillColor(...NAVY)
  doc.rect(M, tableTop, W - M * 2, rowH, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  header.forEach((h, i) => {
    doc.text(String(h).slice(0, 28), M + i * colW + 3, tableTop + 12)
  })

  // Body rows with auto-page-break
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(31, 41, 55)
  let y = tableTop + rowH + 12
  for (let r = 0; r < rows.length; r++) {
    if (y > H - 40) {
      doc.addPage()
      y = 40
      // repeat header band lightly
      doc.setFillColor(241, 245, 249)
      doc.rect(M, y - 12, W - M * 2, rowH, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      header.forEach((h, i) => doc.text(String(h).slice(0, 28), M + i * colW + 3, y))
      y += rowH + 4
      doc.setFont('helvetica', 'normal')
    }
    if (r % 2 === 0) {
      doc.setFillColor(248, 250, 252)
      doc.rect(M, y - 12, W - M * 2, rowH, 'F')
    }
    const cells = rows[r]
    cells.forEach((c, i) => {
      const txt = String(c ?? '').slice(0, 32)
      doc.text(txt, M + i * colW + 3, y)
    })
    y += rowH
  }

  // Footer
  doc.setFontSize(8)
  doc.setTextColor(148, 163, 184)
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.text(`${COMPANY} · ${label} export · page ${p}/${pages}`, W / 2, H - 14, { align: 'center' })
  }

  return doc.output('blob')
}

async function exportDocx(
  moduleName: string,
  header: string[],
  rows: string[][],
  count: number,
): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } = await import('docx')
  const label = MODULE_LABEL[moduleName] ?? moduleName

  const headerCells = header.map((h) =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: String(h), bold: true, color: 'FFFFFF' })] })],
      shading: { fill: NAVY_HEX },
    }),
  )
  const headerRow = new TableRow({ children: headerCells, tableHeader: true })

  const bodyRows = rows.map((cells) =>
    new TableRow({
      children: cells.map((c) =>
        new TableCell({ children: [new Paragraph(String(c ?? ''))] }),
      ),
    }),
  )

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: `${label} Export`,
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: `${COMPANY} · ${count} records · ${new Date().toLocaleString('en-IN')}`,
            alignment: AlignmentType.RIGHT,
          }),
          new Paragraph({ text: '' }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [headerRow, ...bodyRows],
          }),
        ],
      },
    ],
  })

  return Packer.toBlob(doc)
}
