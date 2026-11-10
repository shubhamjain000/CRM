'use client'

/**
 * Print a table via a hidden iframe (works inside embedded previews where
 * window.open is blocked). The user can then "Save as PDF" from the print dialog.
 */
export function printTable(opts: {
  title: string
  headers: string[]
  rows: string[][]
  meta?: string
}) {
  const { title, headers, rows, meta } = opts
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th, td { border: 1px solid #d4d4d4; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; font-size: 10px; }
  tr:nth-child(even) td { background: #fafafa; }
  @page { size: auto; margin: 12mm; }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">${esc(meta ?? `${rows.length} records · generated ${new Date().toLocaleString()}`)}</div>
  <table>
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>
      ${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>
</body>
</html>`

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  if (!doc) { document.body.removeChild(iframe); return }
  doc.open()
  doc.write(html)
  doc.close()
  const win = iframe.contentWindow
  if (win) {
    setTimeout(() => {
      try { win.focus(); win.print() } catch { /* blocked — ignore */ }
      setTimeout(() => document.body.removeChild(iframe), 1000)
    }, 250)
  } else {
    setTimeout(() => document.body.removeChild(iframe), 1000)
  }
}

/** Build a CSV string and trigger a client-side download (for selected rows). */
export function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map((c) => esc(c ?? '')).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
