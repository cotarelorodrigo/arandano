import { NextResponse } from 'next/server'
import { runChecks } from '@/lib/health/runChecks'
import { checks } from '@/lib/health/checks'
import { healthInfo } from '@/lib/health/info'
import { detalleAutorizado, HEADER_SALUD } from '@/lib/health/autorizacion'
import type { HealthResponse, HealthResponsePublica } from '@/lib/health/types'

// Un healthcheck cacheado es un healthcheck que miente.
export const dynamic = 'force-dynamic'

// La respuesta depende del header del token, así que hay que decirlo: dos
// niveles distintos bajo la misma URL y el mismo método. Hoy no hay ningún
// caché intermedio y es inocuo, pero el roadmap inmediato es un dominio real
// con un uptime check externo delante — justo donde aparece uno. Sin `Vary`,
// un caché puede servirle a cualquiera el cuerpo detallado que se le entregó
// al gate del deploy, que es exactamente lo que el cutover sacó de internet.
const CABECERAS = { Vary: 'X-Arandano-Salud' } as const

export async function GET(request: Request) {
  // El veredicto sale SÓLO de los checks. `info` viaja al lado, como
  // contexto: no puede fallar, así que no vota.
  //
  // Los checks corren SIEMPRE, con o sin token: el `status` y el código HTTP
  // son iguales en los dos niveles. Lo único que cambia es cuánto se cuenta.
  // De eso depende que un uptime check externo, que nunca manda el token,
  // siga detectando una base caída.
  const report = await runChecks(checks)
  const status = report.status === 'ok' ? 200 : 503

  if (!detalleAutorizado(request.headers.get(HEADER_SALUD))) {
    // Sin el detalle, este endpoint deja de entregar el nombre de la base, el
    // del rol de conexión, el subdominio de un tenant real y el commit exacto
    // que está corriendo. Era reconocimiento servido a cualquiera que
    // supiera la URL.
    const publica: HealthResponsePublica = { status: report.status }
    return NextResponse.json(publica, { status, headers: CABECERAS })
  }

  const respuesta: HealthResponse = { ...report, info: healthInfo() }
  return NextResponse.json(respuesta, { status, headers: CABECERAS })
}
