import type { HealthCheck, CheckResult, HealthReport } from './types'

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
      detail: err instanceof Error ? err.message : String(err),
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
