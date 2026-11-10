'use client'

import React from 'react'
import DOMPurify from 'isomorphic-dompurify'

/**
 * Real email-body preview — renders template HTML inside a sandboxed iframe
 * (srcDoc) the way a mail client would, instead of inline dangerouslySetInnerHTML:
 *  - full-document rendering: <style> blocks, table layouts, inline fonts and
 *    bg colors all work exactly as the recipient sees them;
 *  - isolated CSS scope: template CSS cannot leak into the CRM UI and the
 *    app's Tailwind reset cannot distort the email;
 *  - scripts are doubly dead: the iframe sandbox has no allow-scripts AND the
 *    payload is DOMPurify-sanitized before it goes into srcDoc.
 */

/**
 * Full-document HTML (doctype/<html>) is preserved as-is; fragments are
 * wrapped in a minimal email-client-like shell.
 *
 * DOMPurify strips <style> blocks even in permissive configs — but real
 * email HTML relies on them heavily. So: extract <style> CSS first, sanitize
 * the markup, sanitize the CSS (kill script-ish payloads), and re-inject the
 * stylesheet into the iframe <head>. Scripts stay doubly dead (sandbox has
 * no allow-scripts, and DOMPurify strips <script> from the markup).
 */
const CSS_BLOCK_RE = /<style[^>]*>([\s\S]*?)<\/style[^>]*>/gi

function sanitizeCss(css: string): string {
  return css
    .replace(/<\/?\s*style[^>]*>/gi, '')
    .replace(/<\s*script/gi, '&lt;script')
    .replace(/javascript\s*:/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/-moz-binding/gi, '')
    .replace(/@import/gi, '')
}

function buildSrcDoc(bodyHtml: string): string {
  const cssBlocks: string[] = []
  const withoutStyles = bodyHtml.replace(CSS_BLOCK_RE, (_m, css: string) => {
    cssBlocks.push(css)
    return ''
  })
  const isFullDocument = /<!doctype\s+html|<html[\s>]/i.test(withoutStyles)
  const safe = isFullDocument
    ? DOMPurify.sanitize(withoutStyles, { WHOLE_DOCUMENT: true })
    : DOMPurify.sanitize(withoutStyles)
  const css = cssBlocks.map(sanitizeCss).join('\n')
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<base target="_blank">',
    '<style>body{margin:0;padding:16px;background:#ffffff;',
    'font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:14px;}</style>',
    css ? `<style>${css}</style>` : '',
    '</head><body>',
    safe || '<p style="color:#9ca3af;margin:0">Empty body</p>',
    '</body></html>',
  ].join('')
}

/** Auto-sizing sandboxed iframe with a real email-client rendering. */
export function EmailHtmlFrame({ html, className }: { html: string; className?: string }) {
  const [height, setHeight] = React.useState(300)
  const srcDoc = React.useMemo(() => buildSrcDoc(html), [html])

  const onLoad = React.useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const doc = e.currentTarget.contentDocument
    if (!doc) return
    const h = Math.max(
      doc.body?.scrollHeight ?? 0,
      doc.documentElement?.scrollHeight ?? 0,
    )
    if (h > 0) setHeight(Math.min(Math.max(h + 8, 120), 2400))
  }, [])

  return (
    <iframe
      title="Email preview"
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      onLoad={onLoad}
      style={{ height }}
      className={className ?? 'w-full rounded-md border bg-white'}
    />
  )
}
