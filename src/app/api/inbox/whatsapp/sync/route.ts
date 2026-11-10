import { NextResponse } from 'next/server'
import { syncWhatsappInbox } from '@/lib/inbox/handler'
export const dynamic = 'force-dynamic'

/**
 * WhatsApp → Unified Inbox sync.
 * Pulls the whatsapp-connector mini-service message log into
 * UnifiedConversation/UnifiedMessage (idempotent — connector ids are stored in
 * message metadata and skipped on re-sync). Safe to call repeatedly; returns
 * ok:false with a reason when the connector service is unreachable.
 */
async function run() {
  try {
    return NextResponse.json(await syncWhatsappInbox())
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 500
    return NextResponse.json({ ok: false, imported: 0, skipped: 0, error: msg }, { status })
  }
}

export async function GET() {
  return run()
}

export async function POST() {
  return run()
}
