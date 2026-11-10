import { NextResponse } from 'next/server'
import { listEmailAccounts, createEmailAccount } from '@/lib/channels/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const accounts = await listEmailAccounts()
    // Strip credentials before returning to the client.
    return NextResponse.json({ accounts: accounts.map(({ credentials, ...rest }) => rest) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.emailAddress || !body?.provider) {
      return NextResponse.json({ error: 'Email address and provider are required' }, { status: 400 })
    }
    const acct = await createEmailAccount(body)
    const { credentials, ...safe } = acct
    return NextResponse.json({ account: safe }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
