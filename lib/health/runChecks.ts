import type { HealthCheck, CheckResult, HealthReport } from './types'

// Node emite AggregateError cuando falla una conexión con varias vías
// posibles (p. ej. pg intentando ::1 y 127.0.0.1 en paralelo). Su
// `.message` de nivel superior queda vacío — la razón real vive en
// `.errors[]` — así que sin este caso especial el detail del reporte
// queda en blanco justo en el motivo de falla más probable.
function detailFromError(err: unknown): string {
  if (err instanceof AggregateError) {
    return err.errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join('; ')
  }
  return err instanceof Error ? err.message : String(err)
}

async function withTimeout(
  promise: Promise<string | void>,
  ms: number,
): Promise<string | void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout tras ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function runOne(check: HealthCheck): Promise<CheckResult> {
  const started = performance.now()
  try {
    const detail = await withTimeout(check.run(), check.timeoutMs)
    return {
      name: check.name,
      ok: true,
      durationMs: Math.round(performance.now() - started),
      ...(detail ? { detail } : {}),
    }
  } catch (err) {
    return {
      name: check.name,
      ok: false,
      durationMs: Math.round(performance.now() - started),
      detail: detailFromError(err),
    }
  }
}

/** Corre todos los checks en paralelo. Cada uno falla aislado: que
 *  Postgres no responda no impide reportar el estado de los demás. */
export async function runChecks(checks: HealthCheck[]): Promise<HealthReport> {
  // `[].every()` es `true`, así que sin este caso una lista vacía daría
  // status 'ok' — HTTP 200, permanentemente verde, con cero evidencia. Y la
  // lista de checks es justamente el array que alguien va a editar para
  // sumar los bloqueantes que faltan (query por tenant, pg-boss): un error de
  // tipeo que la deje vacía no puede convertir el healthcheck en un 200 fijo,
  // que es exactamente lo que este endpoint existe para no ser.
  if (checks.length === 0) {
    return {
      status: 'degraded',
      checks: [
        {
          name: 'checks',
          ok: false,
          durationMs: 0,
          detail:
            'la lista de checks está vacía: no hay nada verificado, así que ' +
            'no hay nada que permita afirmar que el sistema esté sano',
        },
      ],
    }
  }

  const results = await Promise.all(checks.map(runOne))
  return {
    status: results.every((r) => r.ok) ? 'ok' : 'degraded',
    checks: results,
  }
}
