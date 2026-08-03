import { pool } from '@/lib/db'
import type { HealthCheck } from './types'

const appCheck: HealthCheck = {
  name: 'app',
  timeoutMs: 1000,
  // Devolver SHA y uptime distingue "la app arrancó de verdad" de
  // "hay algo escuchando en el puerto".
  run: async () =>
    `sha=${process.env.GIT_SHA ?? 'dev'} uptime=${Math.round(process.uptime())}s`,
}

const postgresCheck: HealthCheck = {
  name: 'postgres',
  timeoutMs: 2000,
  run: async () => {
    const res = await pool.query('SELECT 1 AS ok')
    if (res.rows[0]?.ok !== 1) throw new Error('respuesta inesperada de Postgres')
  },
}

/**
 * La lista de checks del healthcheck.
 *
 * PENDIENTE — bloqueante antes del primer deploy real (ver CLAUDE.md):
 * falta el check de una query filtrada por tenant y el de pg-boss. Sin
 * ellos el rollback automático se dispara con criterio incompleto.
 */
export const checks: HealthCheck[] = [appCheck, postgresCheck]
