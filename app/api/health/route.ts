import { NextResponse } from 'next/server'
import { runChecks } from '@/lib/health/runChecks'
import { checks } from '@/lib/health/checks'

// Un healthcheck cacheado es un healthcheck que miente.
export const dynamic = 'force-dynamic'

export async function GET() {
  const report = await runChecks(checks)
  return NextResponse.json(report, {
    status: report.status === 'ok' ? 200 : 503,
  })
}
