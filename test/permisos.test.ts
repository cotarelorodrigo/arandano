import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'

let owner: Client
let app: Client
let tenantA: string
let tenantB: string
let empleadoA: string
let empleadoB: string

/** Igual que test/rls.test.ts: la GUC fijada adentro de una transacción, que es
 *  como corre la app en producción. */
async function comoTenant(tenantId: string | null, sql: string, params: unknown[] = []) {
  await app.query('BEGIN')
  try {
    if (tenantId !== null) {
      await app.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [tenantId])
    }
    const res = await app.query(sql, params)
    await app.query('COMMIT')
    return res
  } catch (e) {
    await app.query('ROLLBACK')
    throw e
  }
}

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  app = new Client({ connectionString: urlApp() })
  await owner.connect()
  await app.connect()

  tenantA = await crearTenant(owner, 'permisos-a')
  tenantB = await crearTenant(owner, 'permisos-b')
  empleadoA = await crearUsuario(owner, tenantA, 'empleado@permisos-a.test', 'EMPLEADO')
  empleadoB = await crearUsuario(owner, tenantB, 'empleado@permisos-b.test', 'EMPLEADO')
})

afterAll(async () => {
  await owner.end()
  await app.end()
})

describe('la tabla usuario_permisos', () => {
  it('acepta los seis valores del enum', async () => {
    const claves = [
      'ARTICULOS_CREAR', 'ARTICULOS_EDITAR', 'COSTOS',
      'CATEGORIAS', 'VENTAS_ANULAR', 'ORDENES_ANULAR',
    ]
    for (const clave of claves) {
      await comoTenant(
        tenantA,
        `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
         VALUES ($1, $2, $3, now())`,
        [tenantA, empleadoA, clave],
      )
    }
    const { rows } = await comoTenant(
      tenantA,
      `SELECT count(*)::int AS n FROM usuario_permisos WHERE usuario_id = $1`,
      [empleadoA],
    )
    expect(rows[0].n).toBe(6)
  })

  it('rechaza un permiso que no está en el enum', async () => {
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
         VALUES ($1, $2, 'BORRAR_TODO', now())`,
        [tenantA, empleadoA],
      ),
    ).rejects.toThrow()
  })

  // La clave primaria compuesta: otorgar dos veces el mismo permiso no puede
  // dejar dos filas, porque "revocar" es un DELETE y una fila duplicada
  // sobreviviría a la revocación.
  it('no deja otorgar dos veces el mismo permiso', async () => {
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
         VALUES ($1, $2, 'COSTOS', now())`,
        [tenantA, empleadoA],
      ),
    ).rejects.toThrow()
  })

  it('un tenant no ve los permisos de otro', async () => {
    await comoTenant(
      tenantB,
      `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
       VALUES ($1, $2, 'COSTOS', now())`,
      [tenantB, empleadoB],
    )
    const { rows } = await comoTenant(
      tenantA,
      `SELECT count(*)::int AS n FROM usuario_permisos WHERE usuario_id = $1`,
      [empleadoB],
    )
    expect(rows[0].n).toBe(0)
  })

  // Sin GUC no pasa ninguna fila: la policy falla cerrado, igual que el resto.
  it('sin la GUC seteada no se ve nada', async () => {
    const { rows } = await comoTenant(null, `SELECT count(*)::int AS n FROM usuario_permisos`)
    expect(rows[0].n).toBe(0)
  })
})
