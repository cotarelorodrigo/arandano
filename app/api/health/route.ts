import { NextResponse } from 'next/server'
import { runChecks } from '@/lib/health/runChecks'
import { checks } from '@/lib/health/checks'
import { healthInfo } from '@/lib/health/info'
import type { HealthResponse } from '@/lib/health/types'

// Un healthcheck cacheado es un healthcheck que miente.
export const dynamic = 'force-dynamic'

export async function GET() {
  // El veredicto sale SÓLO de los checks. `info` viaja al lado, como
  // contexto: no puede fallar, así que no vota.
  const report = await runChecks(checks)
  const respuesta: HealthResponse = { ...report, info: healthInfo() }

  return NextResponse.json(respuesta, {
    status: report.status === 'ok' ? 200 : 503,
  })
}
