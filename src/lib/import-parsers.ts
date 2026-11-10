/**
 * Multi-format file parsing for bulk import — fully client-side.
 * Supported: CSV, TSV, TXT, XLSX, XLS, JSON, DOCX, PDF.
 * Heavy parsers are lazy-loaded via dynamic import so the main bundle stays small.
 */

export interface ParsedTable {
  headers: string[]
  rows: string[][]
  meta: {
    format: string
    sheets?: string[]
    delimiter?: string
    warnings: string[]
  }
}

export const ACCEPTED_IMPORT_TYPES =
  '.csv,.tsv,.txt,.xlsx,.xls,.json,.docx,.pdf'

export const ACCEPTED_IMPORT_LABEL =
  'CSV, Excel (XLSX/XLS), JSON, Word (DOCX), PDF, TXT'

function isExcel(file: File) {
  return /\.(xlsx|xls)$/i.test(file.name)
}
function isDocx(file: File) {
  return /\.docx$/i.test(file.name)
}
function isPdf(file: File) {
  return /\.pdf$/i.test(file.name)
}
function isJson(file: File) {
  return /\.json$/i.test(file.name)
}

/** Detect the most consistent delimiter among candidate lines. */
function detectDelimiter(lines: string[]): string {
  const candidates = [',', '\t', ';', '|']
  let best = ','
  let bestScore = -1
  for (const d of candidates) {
    const counts = lines.slice(0, 12).map((l) => l.split(d).length - 1)
    const nonZero = counts.filter((c) => c > 0)
    if (nonZero.length === 0) continue
    const min = Math.min(...nonZero)
    if (min === 0) continue // inconsistent — some lines have none
    const score = nonZero.length * 1000 + min
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

/** Split a delimited line respecting double-quoted cells. */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = !inQuotes
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

/** Turn plain text lines (DOCX/PDF/TXT) into a table using delimiter detection. */
export function textToTable(text: string, warnings: string[]): ParsedTable {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) {
    return { headers: [], rows: [], meta: { format: 'text', warnings: [...warnings, 'No text content found in file'] } }
  }
  const delimiter = detectDelimiter(lines)
  const rows = lines.map((l) => splitDelimited(l, delimiter))
  if (delimiter === ',' && !lines[0].includes(',')) {
    warnings.push('No clear column delimiter detected — imported each line as a single column')
  }
  const headers = rows[0].map((h, i) => h || `Column ${i + 1}`)
  const dataRows = rows.slice(1).filter((r) => r.some((c) => c !== ''))
  return {
    headers,
    rows: dataRows,
    meta: { format: 'text', delimiter: delimiter === '\t' ? 'tab' : delimiter, warnings },
  }
}

async function parseCsvLike(file: File, warnings: string[]): Promise<ParsedTable> {
  const Papa = (await import('papaparse')).default
  const text = await file.text()
  const res = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    delimiter: '', // auto-detect
  })
  const rows = (res.data as unknown as string[][]).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''))
  if (rows.length === 0) {
    return { headers: [], rows: [], meta: { format: 'csv', warnings: [...warnings, 'File contains no data rows'] } }
  }
  const headerCount = rows[0].length
  const ragged = rows.filter((r) => r.length !== headerCount).length
  if (ragged > 0) warnings.push(`${ragged} row(s) had a different column count — they were kept as-is`)
  const headers = rows[0].map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`)
  return {
    headers,
    rows: rows.slice(1),
    meta: { format: 'csv', delimiter: res.meta.delimiter, warnings },
  }
}

async function parseExcel(file: File, warnings: string[]): Promise<ParsedTable> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetNames = wb.SheetNames
  // Use the first sheet (most imports are single-sheet)
  const ws = wb.Sheets[sheetNames[0]]
  if (!ws) {
    return { headers: [], rows: [], meta: { format: 'xlsx', sheets: sheetNames, warnings: [...warnings, 'Workbook has no sheets'] } }
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '', raw: false })
  if (matrix.length === 0) {
    return { headers: [], rows: [], meta: { format: 'xlsx', sheets: sheetNames, warnings: [...warnings, 'Sheet is empty'] } }
  }
  const headers = (matrix[0] as unknown[]).map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`)
  const rows = (matrix.slice(1) as unknown[][]).map((r) => r.map((c) => String(c ?? '').trim()))
  if (sheetNames.length > 1) {
    warnings.push(`Workbook has ${sheetNames.length} sheets — imported "${sheetNames[0]}" only`)
  }
  return { headers, rows, meta: { format: 'xlsx', sheets: sheetNames, warnings } }
}

async function parseJsonFile(file: File, warnings: string[]): Promise<ParsedTable> {
  const text = await file.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { headers: [], rows: [], meta: { format: 'json', warnings: [...warnings, 'Invalid JSON file'] } }
  }
  const arr = Array.isArray(data) ? data : typeof data === 'object' && data !== null && Array.isArray((data as { records?: unknown }).records) ? (data as { records: unknown[] }).records : null
  if (!arr || arr.length === 0 || typeof arr[0] !== 'object' || arr[0] === null) {
    return { headers: [], rows: [], meta: { format: 'json', warnings: [...warnings, 'Expected a JSON array of objects, e.g. [{"firstName":"Ada"}]'] } }
  }
  const headerSet = new Set<string>()
  for (const item of (arr as Record<string, unknown>[]).slice(0, 200)) {
    for (const k of Object.keys(item)) headerSet.add(k)
  }
  const headers = [...headerSet]
  const rows = (arr as Record<string, unknown>[]).map((item) =>
    headers.map((h) => {
      const v = item[h]
      if (v === null || v === undefined) return ''
      if (Array.isArray(v)) return v.join('; ')
      if (typeof v === 'object') return JSON.stringify(v)
      return String(v)
    }),
  )
  return { headers, rows, meta: { format: 'json', warnings } }
}

async function parseDocx(file: File, warnings: string[]): Promise<ParsedTable> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  if (result.messages?.length) {
    warnings.push(`DOCX reader reported ${result.messages.length} notice(s)`)
  }
  return textToTable(result.value, [...warnings, 'Parsed from DOCX text — verify the column mapping below'])
}

async function parsePdf(file: File, warnings: string[]): Promise<ParsedTable> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const pageTexts: string[] = []
  const maxPages = Math.min(doc.numPages, 50)
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    // Reconstruct lines using the Y coordinate of text items
    const lineMap = new Map<number, { x: number; str: string }[]>()
    for (const item of content.items) {
      if (!('str' in item) || !item.str?.trim()) continue
      const y = Math.round((item as { transform: number[] }).transform[5])
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y)!.push({ x: (item as { transform: number[] }).transform[4], str: item.str })
    }
    const ys = [...lineMap.keys()].sort((a, b) => b - a)
    for (const y of ys) {
      const parts = lineMap.get(y)!.sort((a, b) => a.x - b.x).map((t) => t.str)
      // Join items that are close together; separate columns with a tab hint
      let line = ''
      let prevEnd: number | null = null
      for (const t of lineMap.get(y)!.sort((a, b) => a.x - b.x)) {
        if (prevEnd !== null && t.x - prevEnd > 12) line += '\t'
        else if (line && !line.endsWith(' ') && !t.str.startsWith(' ')) line += ' '
        line += t.str
        prevEnd = t.x + (t as unknown as { width: number }).width
      }
      void parts
      pageTexts.push(line)
    }
  }
  if (doc.numPages > maxPages) warnings.push(`PDF has ${doc.numPages} pages — imported first ${maxPages}`)
  return textToTable(pageTexts.join('\n'), [...warnings, 'Parsed from PDF text — verify the column mapping below'])
}

/** Parse any supported file into a table. Throws Error with a friendly message on failure. */
export async function parseImportFile(file: File): Promise<ParsedTable> {
  const warnings: string[] = []
  try {
    if (isExcel(file)) return await parseExcel(file, warnings)
    if (isDocx(file)) return await parseDocx(file, warnings)
    if (isPdf(file)) return await parsePdf(file, warnings)
    if (isJson(file)) return await parseJsonFile(file, warnings)
    // csv / tsv / txt / anything text-based
    return await parseCsvLike(file, warnings)
  } catch (e) {
    throw new Error(
      `Could not read "${file.name}": ${e instanceof Error ? e.message.slice(0, 160) : 'unknown error'}`,
    )
  }
}
