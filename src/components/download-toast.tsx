'use client'

import { FileCheck2, Download, X } from 'lucide-react'
import { toast } from 'sonner'

interface DownloadOptions {
  /** Heading shown in the toast, e.g. "Invoice INV-0001 (PDF)". */
  label?: string
  /** How long the toast stays up (ms). Default 60s. */
  duration?: number
}

/**
 * Trigger a client-side file download that also survives sandboxed iframe
 * previews where synthetic anchor clicks can be silently dropped:
 *
 * 1. A best-effort synthetic `<a download>` click starts the download
 *    immediately in normal browsers.
 * 2. A Sonner toast renders a REAL anchor (`href` + `download`) the user can
 *    click themselves — user-activated, so it works even when path 1 is blocked.
 *
 * The blob URL stays alive while the toast is visible, then is revoked.
 */
export function downloadBlob(blob: Blob, filename: string, opts: DownloadOptions = {}) {
  const url = URL.createObjectURL(blob)
  let revoked = false
  const cleanup = () => {
    if (!revoked) {
      revoked = true
      URL.revokeObjectURL(url)
    }
  }

  // 1) Best-effort immediate download via a synthetic anchor click.
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => a.remove(), 4000)
  } catch {
    // Blocked — the toast link below is the reliable path.
  }

  // 2) Toast with a real anchor as an always-available fallback.
  toast.custom(
    (id) => (
      <div
        role="status"
        className="flex w-[min(340px,calc(100vw-2rem))] items-start gap-3 rounded-lg border bg-background p-4 shadow-lg"
      >
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
          <FileCheck2 className="size-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{opts.label ?? 'Your file is ready'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {filename} · {(blob.size / 1024).toFixed(1)} KB
          </p>
          <a
            href={url}
            download={filename}
            onClick={() => setTimeout(() => toast.dismiss(id), 500)}
            className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="size-3.5" /> Download
          </a>
        </div>
        <button
          type="button"
          onClick={() => toast.dismiss(id)}
          aria-label="Dismiss"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    ),
    {
      duration: opts.duration ?? 60000,
      onDismiss: cleanup,
      onAutoClose: cleanup,
    },
  )

  // Safety net: revoke after 2 minutes even if the toast lingers.
  setTimeout(cleanup, 120000)
}
