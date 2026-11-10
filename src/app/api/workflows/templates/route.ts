import { NextResponse } from 'next/server'
import { TEMPLATES } from '@/lib/workflow/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ templates: TEMPLATES })
}
