/** Un check individual del healthcheck. Agregar uno es sumar un elemento
 *  a la lista de `lib/health/checks.ts` — es el punto de extensión. */
export type HealthCheck = {
  name: string
  timeoutMs: number
  /** Devuelve un detalle opcional para el reporte; lanza si el check falla. */
  run: () => Promise<string | void>
}

export type CheckResult = {
  name: string
  ok: boolean
  durationMs: number
  detail?: string
}

export type HealthReport = {
  status: 'ok' | 'degraded'
  checks: CheckResult[]
}

/** Contexto del proceso: qué código sirve y desde cuándo. No es un check —
 *  no puede fallar, así que no participa del veredicto. */
export type HealthInfo = {
  sha: string | null
  uptimeS: number
}

/** Lo que devuelve el endpoint: el veredicto de los checks más el contexto. */
export type HealthResponse = HealthReport & { info: HealthInfo }
