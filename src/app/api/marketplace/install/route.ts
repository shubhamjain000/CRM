import { NextResponse } from 'next/server'
import { installExtension, uninstallExtension } from '@/lib/ecosystem/handler'
export const dynamic = 'force-dynamic'
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (body?.action === 'uninstall' && body.extensionId) {
      await uninstallExtension(body.extensionId)
      return NextResponse.json({ ok: true })
    }
    if (!body?.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
    // Returns the active InstalledExtension WITH its Extension so the UI can
    // flip the badge optimistically without a refetch.
    const installed = await installExtension(body.name)
    return NextResponse.json({ id: installed.id, installed }, { status: 201 })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 }) }
}
