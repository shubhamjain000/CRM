import { NextResponse } from 'next/server'
import { listEmails } from '@/lib/email/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const items = await listEmails({
      starred: url.searchParams.get('starred') === 'true',
      unread: url.searchParams.get('unread') === 'true',
      relatedModule: url.searchParams.get('relatedModule') ?? undefined,
      relatedId: url.searchParams.get('relatedId') ?? undefined,
      // Additive filters: match messages whose from/to/cc contains an email
      // address (used by the record-detail "Emails" tab), and an optional limit.
      address: url.searchParams.get('address') ?? undefined,
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
    })
    return NextResponse.json({ emails: items })
  } catch (e) {
    const s = e instanceof Error && (e.message === 'Unauthorized' || e.message === 'No organization') ? 401 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: s })
  }
}
