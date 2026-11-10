import { NextResponse } from 'next/server'
import { getTodayTasks } from '@/lib/productivity/handler'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const tasks = await getTodayTasks()
    return NextResponse.json({ tasks })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
  }
}
