import { NextResponse } from 'next/server'
import { getCanvasTheme, updateCanvasTheme, THEME_TEMPLATES } from '@/lib/customization/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const theme = await getCanvasTheme()
    return NextResponse.json({ theme, templates: THEME_TEMPLATES })
  } catch (e) {
    // Unauthenticated visitors (e.g. the login screen before any session
    // exists) must get a graceful null theme, not a 500 — the client applier
    // treats null as "no customization" and the UI renders its defaults.
    const msg = e instanceof Error ? e.message : 'Server error'
    if (msg === 'Unauthorized' || msg === 'No organization') {
      return NextResponse.json({ theme: null, templates: THEME_TEMPLATES })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    const theme = await updateCanvasTheme(body)
    return NextResponse.json({ theme })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
