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
