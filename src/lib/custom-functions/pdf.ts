/**
 * Server-side PDF builders for the custom-functions sandbox API (`pdf.invoice`
 * / `pdf.document` in src/lib/custom-functions/handler.ts).
 *
 * Both builders run on the server inside the execution sandbox path and return
 * the PDF as base64 — the sandbox has no filesystem access, so the bytes travel
 * inside the execution output and the Test panel renders a Download button.
 *
 * Layout mirrors `src/lib/invoice-docs.ts` (A4, navy header band, zebra item
 * rows). Money uses the same glyph-safe "Rs." en-IN formatting — jsPDF's
 * built-in Helvetica has no ₹ (U+20B9) glyph, so printed amounts read
 * "Rs. 1,234.00" while the UI/DOCX keep ₹.
 *
 * jspdf is imported dynamically so it never enters the initial bundle, and
 * every validation problem is thrown as a clear Error (the sandbox records it
 * as the execution's failure reason instead of failing silently).
 */
import type { jsPDF } from 'jspdf'

export interface PdfInvoiceItem {
  description: string
  qty: number
  price: number
}

export interface PdfInvoiceData {
  number?: string
  date?: string
  dueDate?: string
  from?: { name?: string; email?: string }
  to?: { name?: string; company?: string; email?: string }
  items: PdfInvoiceItem[]
  taxPercent?: number
  currency?: string
}

export interface PdfDocumentLine {
  text: string
  size?: number
  bold?: boolean
}

export interface PdfDocumentData {
  title: string
  lines: PdfDocumentLine[]
}

export interface PdfResult {
  filename: string
  base64: string
  sizeBytes: number
}

const NAVY: [number, number, number] = [34, 53, 88]
const COMPANY = 'Unstop CRM Platform'
const INK: [number, number, number] = [15, 23, 42]
const SLATE: [number, number, number] = [100, 116, 139]
const TOTAL_GRAY: [number, number, number] = [71, 85, 105]
const LAVENDER: [number, number, number] = [199, 210, 229]
const ZEBRA: [number, number, number] = [246, 247, 249]
const RULE: [number, number, number] = [226, 232, 240]
const FOOTER: [number, number, number] = [148, 163, 184]

const enIN2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Filename-safe slug: "Quarterly Invoice #12" → "Quarterly-Invoice-12". */
function slugify(value: string): string {
  const slug = value.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return slug || 'document'
}

function fmtDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** PDF-safe money: "Rs. 1,234.00" (₹ has no glyph in jsPDF's built-in Helvetica). */
function money(n: number, currency?: string): string {
  let prefix = (currency ?? '').trim() || 'Rs.'
  if (prefix === '₹' || /^INR$/i.test(prefix)) prefix = 'Rs.'
  return `${prefix} ${enIN2.format(Number.isFinite(n) ? n : 0)}`
}

/** Serialize a finished jsPDF doc into the sandbox-facing PdfResult shape. */
function finalize(doc: jsPDF, filename: string): PdfResult {
  const buf = Buffer.from(doc.output('arraybuffer'))
  return { filename, base64: buf.toString('base64'), sizeBytes: buf.byteLength }
}

function drawFooter(doc: jsPDF, W: number, M: number): void {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...FOOTER)
  doc.text(`${COMPANY} · generated ${new Date().toLocaleString('en-IN')}`, M, 812)
  doc.text('System-generated document', W - M, 812, { align: 'right' })
}

/** Validate + coerce raw sandbox items (tolerates `quantity`/`rate` aliases). */
function normalizeItems(raw: unknown): PdfInvoiceItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('pdf.invoice: `items` must be a non-empty array of { description, qty, price } objects')
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`pdf.invoice: item #${i + 1} is not an object ({ description, qty, price })`)
    }
    const it = item as Record<string, unknown>
    const qty = Number(it.qty ?? it.quantity)
    const price = Number(it.price ?? it.rate)
    if (!Number.isFinite(qty)) throw new Error(`pdf.invoice: item #${i + 1} has a non-numeric "qty"`)
    if (!Number.isFinite(price)) throw new Error(`pdf.invoice: item #${i + 1} has a non-numeric "price"`)
    return { description: String(it.description ?? 'Item'), qty, price }
  })
}

/**
 * Build an A4 invoice PDF mirroring the layout in `src/lib/invoice-docs.ts`:
 * navy header band, BILLED TO block, zebra items table with page-breaks,
 * subtotal/tax/total block, footer. Returns { filename, base64, sizeBytes }.
 */
export async function buildInvoicePdf(invoice: PdfInvoiceData): Promise<PdfResult> {
  if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice)) {
    throw new Error('pdf.invoice: pass an invoice object, e.g. { items: [{ description, qty, price }] }')
  }
  // Validation happens before the jsPDF work so these messages surface verbatim.
  const items = normalizeItems(invoice.items)
  const taxPercent = Number(invoice.taxPercent ?? 0)
  if (!Number.isFinite(taxPercent) || taxPercent < 0) {
    throw new Error('pdf.invoice: `taxPercent` must be a non-negative number')
  }

  try {
    const { jsPDF: JsPDF } = await import('jspdf')
    const doc = new JsPDF({ unit: 'pt', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    const M = 48

    const subtotal = items.reduce((sum, it) => sum + it.qty * it.price, 0)
    const tax = (subtotal * taxPercent) / 100
    const total = subtotal + tax
    const number = String(invoice.number || `INV-${Date.now()}`)
    const fromName = invoice.from?.name || COMPANY

    // Header band
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, W, 96, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.text('INVOICE', M, 44)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...LAVENDER)
    doc.text(fromName, M, 62)
    if (invoice.from?.email) {
      doc.setFontSize(8)
      doc.text(invoice.from.email, M, 76)
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(255, 255, 255)
    doc.text(number, W - M, 44, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...LAVENDER)
    doc.text(`Issued: ${fmtDate(invoice.date)}`, W - M, 60, { align: 'right' })
    doc.text(`Due: ${fmtDate(invoice.dueDate)}`, W - M, 74, { align: 'right' })

    // Billed to
    doc.setTextColor(...SLATE)
    doc.setFontSize(8)
    doc.text('BILLED TO', M, 134)
    doc.setTextColor(...INK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(invoice.to?.name || 'Customer', M, 152)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...SLATE)
    let y = 168
    if (invoice.to?.company) {
      doc.text(invoice.to.company, M, y)
      y += 14
    }
    if (invoice.to?.email) {
      doc.text(invoice.to.email, M, y)
      y += 14
    }

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
    items.forEach((it, i) => {
      if (rowY > 720) {
        doc.addPage()
        rowY = 56
        drawTableHeader(rowY)
        rowY += 24
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9.5)
      }
      if (i % 2 === 1) {
        doc.setFillColor(...ZEBRA)
        doc.rect(M, rowY, W - 2 * M, 22, 'F')
      }
      doc.setTextColor(...INK)
      doc.text(it.description.slice(0, 52), M + 10, rowY + 15)
      doc.text(String(it.qty), colQty, rowY + 15, { align: 'right' })
      doc.text(money(it.price, invoice.currency), colRate, rowY + 15, { align: 'right' })
      doc.text(money(it.qty * it.price, invoice.currency), colAmt, rowY + 15, { align: 'right' })
      rowY += 22
    })

    // Totals
    rowY += 12
    const labelX = W - M - 180
    const totalLine = (label: string, value: string, bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(bold ? 12 : 10)
      doc.setTextColor(...(bold ? NAVY : TOTAL_GRAY))
      doc.text(label, labelX, rowY)
      doc.text(value, colAmt, rowY, { align: 'right' })
      rowY += bold ? 20 : 16
    }
    totalLine('Subtotal', money(subtotal, invoice.currency))
    totalLine(`Tax (${taxPercent}%)`, money(tax, invoice.currency))
    doc.setDrawColor(...RULE)
    doc.line(labelX, rowY - 10, colAmt, rowY - 10)
    totalLine('Total', money(total, invoice.currency), true)

    drawFooter(doc, W, M)
    return finalize(doc, `Invoice-${slugify(number)}.pdf`)
  } catch (e) {
    throw new Error(`pdf.invoice failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Build a simple A4 text document PDF: navy header band with the title, then
 * each { text, size?, bold? } line wrapped and paginated. Returns the same
 * { filename, base64, sizeBytes } shape (filename derived from the title).
 */
export async function buildDocumentPdf(data: PdfDocumentData): Promise<PdfResult> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('pdf.document: pass { title, lines: [{ text, size?, bold? }] }')
  }
  const title = String(data.title ?? '').trim()
  if (!title) throw new Error('pdf.document: `title` is required (used for the page header and the filename)')
  if (!Array.isArray(data.lines)) {
    throw new Error('pdf.document: `lines` must be an array of { text, size?, bold? } objects')
  }
  const lines = data.lines.map((line, i) => {
    const rawSize = Number(line?.size ?? 10.5)
    if (!Number.isFinite(rawSize)) throw new Error(`pdf.document: line #${i + 1} has a non-numeric "size"`)
    return {
      text: String(line?.text ?? ''),
      size: Math.min(Math.max(rawSize, 6), 40),
      bold: Boolean(line?.bold),
    }
  })

  try {
    const { jsPDF: JsPDF } = await import('jspdf')
    const doc = new JsPDF({ unit: 'pt', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    const M = 48

    // Header band with the document title (max 2 lines)
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, W, 96, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    const titleLines = (doc.splitTextToSize(title, W - 2 * M - 40) as string[]).slice(0, 2)
    let titleY = 44
    for (const t of titleLines) {
      doc.text(t, M, titleY)
      titleY += 24
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...LAVENDER)
    doc.text(`${COMPANY} · generated ${fmtDate(new Date().toISOString())}`, M, 84)

    // Body lines — wrapped, bold lines render in navy, pagination at the bottom margin
    let y = 140
    for (const line of lines) {
      doc.setFont('helvetica', line.bold ? 'bold' : 'normal')
      doc.setFontSize(line.size)
      const wrapped = (doc.splitTextToSize(line.text || ' ', W - 2 * M) as string[]) || [' ']
      const lineHeight = line.size * 1.45
      for (const seg of wrapped) {
        if (y + lineHeight > 780) {
          doc.addPage()
          y = 56
        }
        doc.setTextColor(...(line.bold ? NAVY : INK))
        doc.text(seg, M, y)
        y += lineHeight
      }
      y += 4
    }

    drawFooter(doc, W, M)
    return finalize(doc, `${slugify(title)}.pdf`)
  } catch (e) {
    throw new Error(`pdf.document failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
