import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

let owner: Client
let app: Client
let tenantA: string
let tenantB: string

/** Corre una consulta con la GUC del tenant fijada, dentro de una transacción,
 *  igual que hace la app en producción. */
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

  tenantA = await crearTenant(owner, 'rls-a')
  tenantB = await crearTenant(owner, 'rls-b')

  for (const [t, nombre] of [[tenantA, 'Cliente de A'], [tenantB, 'Cliente de B']] as const) {
    await owner.query(
      `INSERT INTO clientes (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $2, now(), now())`,
      [t, nombre],
    )
  }
})

afterAll(async () => {
  await owner.end()
  await app.end()
})

describe('aislamiento por RLS', () => {
  it('con la GUC del tenant A sólo se ven los clientes de A', async () => {
    const { rows } = await comoTenant(tenantA, 'SELECT nombre FROM clientes')
    expect(rows).toHaveLength(1)
    expect(rows[0].nombre).toBe('Cliente de A')
  })

  it('sin GUC no se ve ninguna fila: falla cerrado', async () => {
    const { rows } = await comoTenant(null, 'SELECT nombre FROM clientes')
    expect(rows).toHaveLength(0)
  })

  it('con la GUC vacía tampoco, y sin reventar en el cast a uuid', async () => {
    const { rows } = await comoTenant('', 'SELECT nombre FROM clientes')
    expect(rows).toHaveLength(0)
  })

  it('rechaza insertar una fila con el tenant_id de otro', async () => {
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO clientes (id, tenant_id, nombre, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Infiltrado', now(), now())`,
        [tenantB],
      ),
    ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
  })

  it('rechaza mover una fila existente a otro tenant', async () => {
    await expect(
      comoTenant(tenantA, 'UPDATE clientes SET tenant_id = $1', [tenantB]),
    ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
  })

  it('un tenant no puede enumerar a los demás', async () => {
    const { rows } = await comoTenant(tenantA, 'SELECT subdominio FROM tenants')
    expect(rows).toHaveLength(1)
    expect(rows[0].subdominio).toBe('rls-a')
  })

  it('aísla también users, articulos y tenant_modules', async () => {
    await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'SKU-1', 'Sólo de B', 'PRODUCTO', 100.00, now(), now())`,
      [tenantB],
    )
    await owner.query(
      `INSERT INTO tenant_modules (tenant_id, modulo, activado_en) VALUES ($1, 'TURNOS', now())`,
      [tenantB],
    )
    await owner.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Beto', 'beto@ejemplo.com', 'DUENO', now(), now())`,
      [tenantB],
    )

    for (const tabla of ['articulos', 'tenant_modules', 'users']) {
      const { rows: deA } = await comoTenant(tenantA, `SELECT 1 FROM ${tabla}`)
      expect(deA, `${tabla} filtró filas de otro tenant`).toHaveLength(0)

      // La mitad que falta: si la tabla también fuera invisible para su
      // propio dueño (falta el CREATE POLICY, o compara la columna que no
      // es), el assert de arriba daría 0 igual y el test quedaría en verde
      // sin haber probado aislamiento — sólo "vacío para todos".
      const { rows: deB } = await comoTenant(tenantB, `SELECT 1 FROM ${tabla}`)
      expect(deB, `${tabla} no es legible por su propio tenant`).toHaveLength(1)
    }
  })

  it('rechaza insertar un tenant nuevo con un id que no coincide con la GUC', async () => {
    // La app nunca puede acertar el id: es un uuid al azar, así que esto es
    // lo que hace verdadera la afirmación de test/datos.ts de que sólo el
    // owner puede crear tenants — arandano_app sí tiene GRANT INSERT.
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO tenants (id, subdominio, nombre, estado, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), 'rls-infiltrado', 'rls-infiltrado', 'TRIAL', now(), now())`,
      ),
    ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
  })

  it('rechaza insertar en tenant_modules con el tenant_id de otro', async () => {
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO tenant_modules (tenant_id, modulo, activado_en) VALUES ($1, 'GASTRONOMIA', now())`,
        [tenantB],
      ),
    ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
  })

  it('rechaza insertar en users con el tenant_id de otro', async () => {
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Infiltrado', 'infiltrado@ejemplo.com', 'EMPLEADO', now(), now())`,
        [tenantB],
      ),
    ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
  })

  it('rechaza insertar en articulos con el tenant_id de otro', async () => {
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'SKU-INFILTRADO', 'Infiltrado', 'PRODUCTO', 1.00, now(), now())`,
        [tenantB],
      ),
    ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
  })
})
