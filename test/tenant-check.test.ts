import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Client, Pool } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

/**
 * Hallazgo 4 de la review de la Task 6: lib/health/checks.test.ts mockea
 * pool.query()/pool.connect() y prueba la lógica de ramas dado lo que
 * responde la base -- nunca corre el check contra Postgres de verdad. Una
 * implementación que borrara el segundo set_config, que pasara `false` como
 * tercer argumento, que corriera los dos conteos en conexiones distintas del
 * pool, o que contara una tabla sin RLS pasaría esos tests igual.
 *
 * Este archivo corre el check `tenant` de lib/health/checks.ts tal cual,
 * contra el Postgres efímero de test/global-setup.ts (el mismo que usan
 * test/rls.test.ts y test/resolver-tenant.test.ts): primero conectado como
 * arandano_app (tiene que pasar) y después como arandano_owner, que está
 * exento de las policies de sus propias tablas -- ninguna tiene FORCE ROW
 * LEVEL SECURITY (ver el comentario de la migración de resolver_tenant) --
 * así que ahí el check tiene que detectar que el aislamiento no aplica y
 * lanzar.
 */

let owner: Client
let subdominio: string

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  subdominio = 'tenant-check-canario'
  await crearTenant(owner, subdominio)
})

afterAll(async () => {
  await owner.end()
})

/**
 * Corre el check `tenant` de verdad, conectado con la URL dada.
 *
 * Mockea `@/lib/db` con un pg.Pool REAL apuntando a esa URL -- no usa el
 * pool singleton de lib/db.ts, que queda atado a la primera URL con la que
 * se construye (vive en `globalThis`, y `vi.resetModules()` no lo limpia) y
 * no puede cambiar de rol en el medio de un archivo de test. `vi.doMock` (no
 * hoisted) permite registrar un mock DISTINTO antes de cada import dinámico.
 */
async function correrComo(url: string): Promise<string | void> {
  const pool = new Pool({ connectionString: url })
  vi.resetModules()
  vi.doMock('@/lib/db', () => ({ pool }))
  const original = process.env.TENANT_CANARIO_SUBDOMINIO
  process.env.TENANT_CANARIO_SUBDOMINIO = subdominio
  try {
    const { checks } = await import('@/lib/health/checks')
    const tenantCheck = checks.find((c) => c.name === 'tenant')!
    return await tenantCheck.run()
  } finally {
    if (original === undefined) delete process.env.TENANT_CANARIO_SUBDOMINIO
    else process.env.TENANT_CANARIO_SUBDOMINIO = original
    vi.doUnmock('@/lib/db')
    await pool.end()
  }
}

describe('check de tenant, contra Postgres real', () => {
  it('conectado como arandano_app: RLS filtra en las dos direcciones y el check pasa', async () => {
    await expect(correrComo(urlApp())).resolves.toBe(`canario=${subdominio}`)
  })

  // El caso decisivo, y el que la review verificó a mano: arandano_owner es
  // dueño de `tenants` y ninguna tabla tiene FORCE ROW LEVEL SECURITY, así
  // que las policies no se le aplican -- ve todas las filas sin importar qué
  // tenant_id tenga seteado el GUC. Con eso, la mitad "propio" y la mitad
  // "ajeno" del check devuelven el MISMO conteo (el total de la tabla), así
  // que al menos una de las dos comparaciones tiene que fallar -- sin
  // importar cuántos tenants haya insertado el resto de la suite en esta
  // misma base compartida. Por eso la aserción no fija un número exacto:
  // cualquiera de los dos mensajes de error confirma que el check detectó
  // que el aislamiento no aplica.
  it('conectado como arandano_owner: el dueño está exento de RLS y el check lanza', async () => {
    await expect(correrComo(urlOwner())).rejects.toThrow(
      /tendría que devolver 1|RLS no está filtrando/,
    )
  })
})
