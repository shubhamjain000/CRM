import { NextResponse } from 'next/server'
import { exportReport } from '@/lib/reports/handler'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const url = new URL(req.url)
    const format = (url.searchParams.get('format') ?? 'csv') as 'csv' | 'json'
    const data = await exportReport(id, format)
    return new NextResponse(data, {
      headers: {
        'Content-Type': format === 'csv' ? 'text/csv' : 'application/json',
        'Content-Disposition': `attachment; filename="report.${format}"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
