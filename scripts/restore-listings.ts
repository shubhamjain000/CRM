/**
 * One-off recovery utility: parse a CSM J&I export CSV into the exact row
 * JSON shape the Import Wizard POSTs to /api/crm/import, so listings wiped by
 * the 11-03 publish incident can be restored through the normal import
 * pipeline (validate → dedupe → account resolution → listing history).
 *
 * Usage:  bun scripts/restore-listings.ts <csv-path> > /tmp/rows.json
 * Then:   see scripts/restore-listings.sh
 */

interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

/** RFC4180 parser — quoted fields, escaped quotes, CRLF, embedded commas. */
function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++ }
        else inQuotes = false
      } else cell += ch
      continue
    }
    if (ch === '"') { inQuotes = true; continue }
    if (ch === ',') { row.push(cell); cell = ''; continue }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
      continue
    }
    cell += ch
  }
  row.push(cell)
  if (row.some((c) => c !== '')) rows.push(row)
  const headers = rows.shift() ?? []
  return { headers: headers.map((h) => h.trim()), rows }
}

/** CSM export header → canonical import-core contact field. */
const HEADER_MAP: Record<string, string> = {
  date_approved: 'dateApproved',
  full_name: 'fullName',
  company: 'company',
  email_id: 'emails',
  mobile_no: 'phones',
  listing_link: 'listingUrl',
  listing_title: 'listingTitle',
  subtype: 'listingSubtype',
  category: 'listingCategory',
  applications: 'totalApplications',
  reasonable_score_users: 'reasonableScoreUsers',
  'reasonable_fit_%': 'reasonableFitPct',
  recruiter_tag: 'recruiterTag',
  premium: 'premiumStatus',
  visibility: 'visibility',
  hiring_status: 'hiringStatus',
  relevant_applications: 'relevantApplications',
  hired_count: 'hiredCount',
}

const path = process.argv[2]
if (!path) {
  console.error('Usage: bun scripts/restore-listings.ts <csv-path> > rows.json')
  process.exit(1)
}

const file = await Bun.file(path)
const { headers, rows } = parseCsv(await file.text())

const keyByIndex = headers.map((h) => HEADER_MAP[h.toLowerCase().trim()] ?? null)
const unmapped = headers.filter((h, i) => !keyByIndex[i])
if (unmapped.length) console.error(`[restore] unmapped headers: ${unmapped.join(', ')}`)

const out = rows.map((cells) => {
  const obj: Record<string, string> = {}
  cells.forEach((cell, idx) => {
    const key = keyByIndex[idx]
    if (key && cell.trim() !== '') obj[key] = cell.trim()
  })
  return obj
})

console.log(JSON.stringify(out))
console.error(`[restore] ${out.length} rows parsed from ${path}`)
