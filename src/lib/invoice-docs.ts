/**
 * Invoice document generation — PDF (jsPDF) and DOCX (docx), both client-side
 * with dynamic imports so the heavy libraries never enter the initial bundle.
 * Numbers use the platform-wide ₹ / en-IN formatting from lib/money.
 */
import { fmtINR } from '@/lib/money'

export const NAVY: [number, number, number] = [34, 53, 88]
export const COMPANY = 'Unstop CRM Platform'

export interface InvoiceLineItem {
  description?: string
  quantity: number
  rate: number
}

export interface InvoiceDocData {
  invoiceNumber: string
  customerName: string
  customerEmail?: string | null
  status: string
  issueDate?: string | Date | null
  dueDate?: string | Date | null
  subtotal: number
  tax: number
  total: number
  notes?: string | null
  lineItems?: string | InvoiceLineItem[] | null
}

/** lineItems is stored as a JSON string — parse defensively. */
export function parseLineItems(inv: InvoiceDocData): InvoiceLineItem[] {
  const raw = inv.lineItems
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function fmtDate(d?: string | Date | null): string {
  if (!d) return fmtDate(new Date())
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * PDF-safe money format. jsPDF's built-in Helvetica has no ₹ (U+20B9) glyph —
 * it renders as a fallback box — so printed amounts use the standard Indian
 * "Rs." notation with the same en-IN digit grouping. (DOCX/UI keep ₹.)
 */
const enIN2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function fmtPdfMoney(n: number): string {
  return `Rs. ${enIN2.format(Number.isFinite(n) ? n : 0)}`
}

// ---------------------------------------------------------------------------
// PDF (jsPDF, A4)
// ---------------------------------------------------------------------------

export async function invoicePdfBlob(inv: InvoiceDocData): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 48
  const items = parseLineItems(inv)

  // Header band
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 96, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('INVOICE', M, 44)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(199, 210, 229)
  doc.text(COMPANY, M, 62)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  doc.text(inv.invoiceNumber, W - M, 44, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(199, 210, 229)
  doc.text(`Status: ${inv.status}`, W - M, 60, { align: 'right' })
  doc.text(`Due date: ${fmtDate(inv.dueDate)}`, W - M, 74, { align: 'right' })

  // Billed to
  doc.setTextColor(100, 116, 139)
  doc.setFontSize(8)
  doc.text('BILLED TO', M, 134)
  doc.setTextColor(15, 23, 42)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(inv.customerName, M, 152)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(100, 116, 139)
  let y = 166
  if (inv.customerEmail) {
    doc.text(inv.customerEmail, M, y)
    y += 14
  }
  doc.text(`Issued: ${fmtDate(inv.issueDate)}`, M, y)

  // Items table
  const tableTop = 210
  const colQty = W - M - 130
  const colRate = W - M - 62
  const colAmt = W - M
  const drawTableHeader = (top: number) => {
    doc.setFillColor(...NAVY)
    doc.rect(M, top, W - 2 * M, 24, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('DESCRIPTION', M + 10, top + 16)
    doc.text('QTY', colQty, top + 16, { align: 'right' })
    doc.text('RATE', colRate, top + 16, { align: 'right' })
    doc.text('AMOUNT', colAmt, top + 16, { align: 'right' })
  }
  drawTableHeader(tableTop)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  let rowY = tableTop + 24
  const drawRows = (rows: InvoiceLineItem[]) => {
    if (rows.length === 0) {
      doc.setTextColor(100, 116, 139)
      doc.setFont('helvetica', 'italic')
      doc.text('No line items on this invoice.', M + 10, rowY + 15)
      rowY += 26
      doc.setFont('helvetica', 'normal')
      return
    }
    rows.forEach((it, i) => {
      if (rowY > 720) {
        doc.addPage()
        rowY = 56
        drawTableHeader(rowY)
        rowY += 24
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9.5)
      }
      if (i % 2 === 1) {
        doc.setFillColor(246, 247, 249)
        doc.rect(M, rowY, W - 2 * M, 22, 'F')
      }
      doc.setTextColor(15, 23, 42)
      const desc = (it.description || 'Item').slice(0, 52)
      doc.text(desc, M + 10, rowY + 15)
      doc.text(String(it.quantity ?? 0), colQty, rowY + 15, { align: 'right' })
      doc.text(fmtPdfMoney(it.rate ?? 0), colRate, rowY + 15, { align: 'right' })
      doc.text(fmtPdfMoney((it.quantity ?? 0) * (it.rate ?? 0)), colAmt, rowY + 15, { align: 'right' })
      rowY += 22
    })
  }
  drawRows(items)

  // Totals
  rowY += 12
  const labelX = W - M - 180
  const totalLine = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(bold ? 12 : 10)
    doc.setTextColor(bold ? 34 : 71, bold ? 53 : 85, bold ? 88 : 105)
    doc.text(label, labelX, rowY)
    doc.text(value, colAmt, rowY, { align: 'right' })
    rowY += bold ? 20 : 16
  }
  totalLine('Subtotal', fmtPdfMoney(inv.subtotal))
  totalLine('GST (18%)', fmtPdfMoney(inv.tax))
  doc.setDrawColor(226, 232, 240)
  doc.line(labelX, rowY - 10, colAmt, rowY - 10)
  totalLine('Total', fmtPdfMoney(inv.total), true)

  // Notes
  if (inv.notes) {
    rowY += 16
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text('NOTES', M, rowY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(71, 85, 105)
    const lines = doc.splitTextToSize(inv.notes, W - 2 * M) as string[]
    doc.text(lines.slice(0, 4), M, rowY + 13)
  }

  // Footer
  doc.setFontSize(8)
  doc.setTextColor(148, 163, 184)
  doc.text(`${COMPANY} · generated ${new Date().toLocaleString('en-IN')}`, M, 812)
  doc.text('System-generated document', W - M, 812, { align: 'right' })

  return doc.output('blob')
}

// ---------------------------------------------------------------------------
// DOCX (docx package, Packer.toBlob)
// ---------------------------------------------------------------------------

export async function invoiceDocxBlob(inv: InvoiceDocData): Promise<Blob> {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
    ShadingType,
  } = await import('docx')

  const items = parseLineItems(inv)
  const NAVY_HEX = '223558'
  const GRAY = '64748B'
  const BORDER = 'D8DEE6'
  type Align = (typeof AlignmentType)[keyof typeof AlignmentType]

  const cell = (
    text: string,
    opts: { bold?: boolean; color?: string; align?: Align; fill?: string } = {},
  ) =>
    new TableCell({
      shading: opts.fill
        ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill }
        : undefined,
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [
        new Paragraph({
          alignment: opts.align,
          children: [
            new TextRun({ text, bold: opts.bold, color: opts.color ?? '1F2937', size: 20 }),
          ],
        }),
      ],
    })

  const metaLine = (label: string, value: string) =>
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: `${label}:  `, bold: true, color: GRAY, size: 20 }),
        new TextRun({ text: value, size: 20 }),
      ],
    })

  const totalsRow = (label: string, value: string, bold: boolean) =>
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 3,
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          shading: bold ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' } : undefined,
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: label, bold, color: bold ? NAVY_HEX : GRAY, size: bold ? 22 : 20 })],
            }),
          ],
        }),
        cell(value, { align: AlignmentType.RIGHT, bold, fill: bold ? 'F1F5F9' : undefined, color: bold ? NAVY_HEX : '1F2937' }),
      ],
    })

  const doc = new Document({
    sections: [
      {
        properties: {
          page: { margin: { top: 900, right: 900, bottom: 900, left: 900 } },
        },
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'INVOICE', bold: true, size: 44, color: NAVY_HEX })],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [new TextRun({ text: COMPANY, size: 18, color: GRAY })],
          }),
          metaLine('Invoice No', inv.invoiceNumber),
          metaLine('Status', inv.status),
          metaLine('Issue date', fmtDate(inv.issueDate)),
          metaLine('Due date', fmtDate(inv.dueDate)),
          new Paragraph({ spacing: { after: 120 }, text: '' }),
          new Paragraph({
            children: [new TextRun({ text: 'BILLED TO', bold: true, size: 16, color: GRAY })],
          }),
          new Paragraph({
            children: [new TextRun({ text: inv.customerName, bold: true, size: 26 })],
          }),
          ...(inv.customerEmail
            ? [new Paragraph({
                spacing: { after: 240 },
                children: [new TextRun({ text: inv.customerEmail, size: 20, color: GRAY })],
              })]
            : [new Paragraph({ spacing: { after: 240 }, text: '' })]),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
              left: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
              right: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
              insideVertical: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
            },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  cell('Description', { bold: true, color: 'FFFFFF', fill: NAVY_HEX }),
                  cell('Qty', { bold: true, color: 'FFFFFF', fill: NAVY_HEX, align: AlignmentType.RIGHT }),
                  cell('Rate', { bold: true, color: 'FFFFFF', fill: NAVY_HEX, align: AlignmentType.RIGHT }),
                  cell('Amount', { bold: true, color: 'FFFFFF', fill: NAVY_HEX, align: AlignmentType.RIGHT }),
                ],
              }),
              ...(items.length === 0
                ? [new TableRow({
                    children: [
                      new TableCell({
                        columnSpan: 4,
                        margins: { top: 100, bottom: 100, left: 160, right: 160 },
                        children: [
                          new Paragraph({
                            children: [new TextRun({ text: 'No line items on this invoice.', italics: true, color: GRAY, size: 20 })],
                          }),
                        ],
                      }),
                    ],
                  })]
                : items.map((it) =>
                    new TableRow({
                      children: [
                        cell(it.description || 'Item'),
                        cell(String(it.quantity ?? 0), { align: AlignmentType.RIGHT }),
                        cell(fmtINR(it.rate ?? 0), { align: AlignmentType.RIGHT }),
                        cell(fmtINR((it.quantity ?? 0) * (it.rate ?? 0)), { align: AlignmentType.RIGHT }),
                      ],
                    }),
                  )),
              totalsRow('Subtotal', fmtINR(inv.subtotal), false),
              totalsRow('GST (18%)', fmtINR(inv.tax), false),
              totalsRow('Total', fmtINR(inv.total), true),
            ],
          }),
          ...(inv.notes
            ? [
                new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: 'NOTES', bold: true, size: 16, color: GRAY })] }),
                new Paragraph({
                  children: [new TextRun({ text: inv.notes, size: 20, color: '475569' })],
                }),
              ]
            : []),
          new Paragraph({ spacing: { before: 360 }, children: [new TextRun({ text: `Generated by ${COMPANY} · ${fmtDate(new Date())} · System-generated document`, size: 16, color: '94A3B8' })] }),
        ],
      },
    ],
  })

  return Packer.toBlob(doc)
}
