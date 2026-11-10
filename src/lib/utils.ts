import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import DOMPurify from 'isomorphic-dompurify'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Sanitize untrusted HTML (e.g. inbound email bodies) before rendering.
 * Uses DOMPurify (isomorphic build) — strips scripts, event handlers,
 * dangerous URLs/protocols; keeps safe formatting tags/attributes.
 * Form/iframe/embed elements and <style> are removed entirely.
 */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return ''
  return DOMPurify.sanitize(dirty, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'iframe', 'object', 'embed'],
  })
}
