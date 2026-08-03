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
  const results = await Promise.all(checks.map(runOne))
  return {
    status: results.every((r) => r.ok) ? 'ok' : 'degraded',
    checks: results,
  }
}
