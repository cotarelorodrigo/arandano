import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner } from './postgres-efimero'

let cliente: Client

beforeAll(async () => {
  cliente = new Client({ connectionString: urlOwner() })
  await cliente.connect()
})

afterAll(async () => {
  await cliente.end()
})

describe('la migración inicial', () => {
  it('crea las cinco tablas con nombres en snake_case', async () => {
    const { rows } = await cliente.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    const tablas = rows.map((r) => r.tablename)
    expect(tablas).toEqual(
      expect.arrayContaining(['articulos', 'clientes', 'tenant_modules', 'tenants', 'users']),
    )
  })

  it('nombra las columnas en snake_case', async () => {
    const { rows } = await cliente.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' ORDER BY column_name`,
    )
    const columnas = rows.map((r) => r.column_name)
    expect(columnas).toContain('tenant_id')
    expect(columnas).toContain('creado_en')
    expect(columnas).not.toContain('tenantId')
  })

  it('guarda el precio como numeric(12,2), no como flotante', async () => {
    const { rows } = await cliente.query(
      `SELECT data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='articulos' AND column_name='precio'`,
    )
    expect(rows[0].data_type).toBe('numeric')
    expect(rows[0].numeric_precision).toBe(12)
    expect(rows[0].numeric_scale).toBe(2)
  })

  it('permite el mismo email en dos tenants y lo rechaza dentro del mismo', async () => {
    const a = await crearTenantCrudo('unicidad-a')
    const b = await crearTenantCrudo('unicidad-b')

    await cliente.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Ana', 'ana@ejemplo.com', 'DUENO', now(), now())`,
      [a],
    )
    // El mismo email en OTRO tenant tiene que entrar.
    await expect(
      cliente.query(
        `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Ana', 'ana@ejemplo.com', 'DUENO', now(), now())`,
        [b],
      ),
    ).resolves.toBeDefined()
    // Repetido dentro del MISMO tenant, no.
    await expect(
      cliente.query(
        `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Otra Ana', 'ana@ejemplo.com', 'EMPLEADO', now(), now())`,
        [a],
      ),
    ).rejects.toThrow(/duplicate key|llave duplicada/i)
  })
})

async function crearTenantCrudo(subdominio: string): Promise<string> {
  const { rows } = await cliente.query(
    `INSERT INTO tenants (id, subdominio, nombre, estado, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $1, 'TRIAL', now(), now())
     RETURNING id`,
    [subdominio],
  )
  return rows[0].id
}
