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
    // El nombre esperado sale del entorno (ARANDANO_DB_ESPERADA, que cada compose
    // fija junto al stack) y NO se deriva de DATABASE_URL: derivarlo de la
    // misma variable que puede estar mal no comprueba nada, siempre coincide
    // consigo misma.
    const esperada = process.env.ARANDANO_DB_ESPERADA
    if (!esperada) {
      throw new Error(
        'ARANDANO_DB_ESPERADA no está definida: el healthcheck no puede confirmar ' +
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
 * Con qué rol está hablando la app.
 *
 * El check de arriba comprueba contra QUÉ BASE; éste, con QUÉ ROL. Un
 * DATABASE_URL apuntando al superusuario deja las policies de RLS
 * completamente inertes —Postgres las ignora para superusuarios y para el
 * dueño de la tabla— y no hay ningún síntoma: las queries siguen andando, sólo
 * que devuelven los datos de todos los tenants. Es exactamente la clase de
 * fallo que no se nota hasta que un cliente ve los datos de otro.
 */
const rolCheck: HealthCheck = {
  name: 'rol',
  timeoutMs: 2000,
  run: async () => {
    const res = await pool.query(`
      SELECT r.rolname                AS rol,
             r.rolsuper               AS super,
             r.rolbypassrls           AS bypassrls,
             EXISTS (
               SELECT 1 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relowner = r.oid
             )                        AS es_dueno
        FROM pg_roles r
       WHERE r.rolname = current_user
    `)

    const fila = res.rows[0]
    if (!fila) throw new Error('no se pudo determinar el rol de conexión')

    if (fila.super) {
      throw new Error(
        `la app está conectada como "${fila.rol}", que es SUPERUSUARIO: ` +
          'Postgres ignora las policies de RLS para ese rol, así que el ' +
          'aislamiento entre tenants no está aplicando',
      )
    }
    if (fila.bypassrls) {
      throw new Error(
        `el rol "${fila.rol}" tiene BYPASSRLS: las policies no se le aplican`,
      )
    }
    if (fila.es_dueno) {
      throw new Error(
        `el rol "${fila.rol}" es DUEÑO de tablas de public: el dueño está exento ` +
          'de sus propias policies salvo con FORCE ROW LEVEL SECURITY. La app ' +
          'tiene que conectarse con arandano_app, no con arandano_owner',
      )
    }

    return `rol=${fila.rol}`
  },
}

/**
 * La lista de checks del healthcheck.
 *
 * Sólo entra acá lo que puede FALLAR. El SHA y el uptime del proceso son
 * contexto, no señal: se reportan aparte, en `info` (ver `info.ts`).
 *
 * PENDIENTE — bloqueante antes del primer deploy real (ver CLAUDE.md):
 * falta el check de una query filtrada por tenant, que necesita un tenant
 * conocido al que apuntar (llega con el tenant canario), y el de pg-boss, que
 * espera a que pg-boss se configure.
 */
export const checks: HealthCheck[] = [postgresCheck, rolCheck]
