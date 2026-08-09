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
 * Un uuid que no puede ser de ningún tenant: los ids reales son v7
 * (`@default(uuid(7))`) o v4 (`gen_random_uuid()` del alta), y ninguno de los
 * dos genera este patrón de ceros.
 */
const TENANT_INEXISTENTE = '00000000-0000-4000-8000-000000000000'

/**
 * Que el aislamiento entre tenants esté APLICANDO, no sólo que una query
 * filtrada devuelva algo.
 *
 * La versión literal del bloqueante — "una query real filtrada por tenant que
 * devuelva datos" — no alcanza: una query filtrada devuelve datos igual con RLS
 * apagado, así que un check que sólo mire eso pasa exactamente en el estado que
 * existe para detectar. Por eso hay dos mitades, y la que importa es la
 * negativa: con un tenant_id inventado no se puede ver ni una fila.
 *
 * Atrapa un BYPASSRLS otorgado por error, una policy caída en una migración, y
 * la aplicación conectada con un rol exento.
 */
const tenantCheck: HealthCheck = {
  name: 'tenant',
  timeoutMs: 3000,
  run: async () => {
    const subdominio = process.env.TENANT_CANARIO_SUBDOMINIO
    if (!subdominio) {
      throw new Error(
        'TENANT_CANARIO_SUBDOMINIO no está definida: el healthcheck no tiene a qué ' +
          'tenant apuntar, así que no puede comprobar que el aislamiento aplique. ' +
          'Definirla en el compose del stack.',
      )
    }

    // Por la misma puerta que usa la aplicación, así el check también la ejercita.
    const { rows } = await pool.query('SELECT id FROM resolver_tenant($1)', [subdominio])
    const tenantId = rows[0]?.id
    if (!tenantId) {
      throw new Error(
        `el tenant canario "${subdominio}" no existe en esta base: crearlo con ` +
          '`npm run tenant:crear` antes de deployar este código',
      )
    }

    // Una conexión dedicada y no pool.query(): set_config(..., true) es local a
    // la transacción, y dos pool.query() pueden caer en clientes distintos.
    const cliente = await pool.connect()
    try {
      try {
        await cliente.query('BEGIN')

        await cliente.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [tenantId])
        const propio = await cliente.query('SELECT count(*)::int AS n FROM tenants')

        // El segundo set_config pisa al primero dentro de la misma transacción.
        await cliente.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [TENANT_INEXISTENTE])
        const ajeno = await cliente.query('SELECT count(*)::int AS n FROM tenants')

        await cliente.query('ROLLBACK')

        if (propio.rows[0].n !== 1) {
          throw new Error(
            `con el tenant_id del canario "${subdominio}" la base devolvió ` +
              `${propio.rows[0].n} filas de tenants y tendría que devolver 1`,
          )
        }
        if (ajeno.rows[0].n !== 0) {
          throw new Error(
            `con un tenant_id inventado la base devolvió ${ajeno.rows[0].n} filas de ` +
              'tenants: RLS no está filtrando y el aislamiento entre tenants no aplica',
          )
        }
      } catch (err) {
        // Cualquier error entre el BEGIN y el ROLLBACK de arriba (la tabla
        // ausente en una ventana de expand/contract, un rol sin SELECT, un
        // statement_timeout, un deadlock) deja al cliente en 25P02 ("current
        // transaction is aborted"). pg-pool NO hace rollback al liberar: sin
        // pasarle el error, `_queryable` sigue en true y el cliente vuelve al
        // pool de idle todavía adentro de la transacción rota. La PRÓXIMA
        // consulta de cualquiera que lo tome —incluida la corrida siguiente de
        // este mismo check, cuyo propio BEGIN fallaría igual y volvería a
        // liberar sin ROLLBACK— hereda el mismo estado. Con `max: 5` y un
        // endpoint que sondean el gate y el uptime check externo, cinco
        // sondeos envenenan el pool entero: la app queda caída para todos los
        // tenants por un healthcheck que rompió lo que monitorea.
        await cliente.query('ROLLBACK').catch(() => {})
        throw err
      }
    } finally {
      cliente.release()
    }

    return `canario=${subdominio}`
  },
}

/**
 * La lista de checks del healthcheck.
 *
 * Sólo entra acá lo que puede FALLAR. El SHA y el uptime del proceso son
 * contexto, no señal: se reportan aparte, en `info` (ver `info.ts`).
 *
 * PENDIENTE — ver CLAUDE.md: falta el check de pg-boss, que espera a que
 * pg-boss se configure.
 */
export const checks: HealthCheck[] = [postgresCheck, rolCheck, tenantCheck]
