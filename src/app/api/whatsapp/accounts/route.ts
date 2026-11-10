import { NextResponse } from 'next/server'
import { listWhatsAppAccounts, createWhatsAppAccount } from '@/lib/channels/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const accounts = await listWhatsAppAccounts()
    // Strip access token before returning to the client.
    return NextResponse.json({ accounts: accounts.map(({ accessToken, ...rest }) => rest) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.displayName || !body?.displayPhoneNumber || !body?.wabaId || !body?.phoneNumberId || !body?.accessToken) {
      return NextResponse.json({ error: 'Display name, phone number, WABA ID, Phone Number ID and access token are all required' }, { status: 400 })
    }
    const acct = await createWhatsAppAccount(body)
    const { accessToken, ...safe } = acct
    return NextResponse.json({ account: safe }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const status = msg === 'Unauthorized' || msg === 'No organization' ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
