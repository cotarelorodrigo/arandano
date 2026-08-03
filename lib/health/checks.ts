import { pool } from '@/lib/db'
import type { HealthCheck } from './types'

const postgresCheck: HealthCheck = {
  name: 'postgres',
  timeoutMs: 2000,
  run: async () => {
    // `SELECT 1` prueba que HAY una base del otro lado, no CUÁL. Una app de
    // producción con DATABASE_URL apuntando por error al Postgres de dev
    // responde que sí, y el healthcheck la declara sana — justo el escenario
    // que este endpoint existe para atrapar, porque sin feature flags el
    // rollback automático se dispara con lo que este reporte diga.
    //
    // El nombre esperado sale del entorno (NGF_DB_ESPERADA, que cada compose
    // fija junto al stack) y NO se deriva de DATABASE_URL: derivarlo de la
    // misma variable que puede estar mal no comprueba nada, siempre coincide
    // consigo misma.
    const esperada = process.env.NGF_DB_ESPERADA
    if (!esperada) {
      throw new Error(
        'NGF_DB_ESPERADA no está definida: el healthcheck no puede confirmar ' +
          'contra qué base está hablando, así que tampoco puede afirmar que ' +
          'esté sana. Definirla en el compose del stack.',
      )
    }

    const res = await pool.query('SELECT current_database() AS db')
    const db = res.rows[0]?.db
    if (db !== esperada) {
      throw new Error(
        `conectado a la base "${db}" pero este stack espera "${esperada}": ` +
          'DATABASE_URL apunta al Postgres equivocado',
      )
    }
    return `db=${db}`
  },
}

/**
 * La lista de checks del healthcheck.
 *
 * Sólo entra acá lo que puede FALLAR. El SHA y el uptime del proceso son
 * contexto, no señal: se reportan aparte, en `info` (ver `info.ts`).
 *
 * PENDIENTE — bloqueante antes del primer deploy real (ver CLAUDE.md):
 * falta el check de una query filtrada por tenant y el de pg-boss. Sin
 * ellos el rollback automático se dispara con criterio incompleto.
 */
export const checks: HealthCheck[] = [postgresCheck]
