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

describe('la migración de inventario', () => {
  it('guarda el costo del movimiento como numeric(12,2) nullable', async () => {
    const { rows } = await cliente.query(
      `SELECT data_type, numeric_precision, numeric_scale, is_nullable
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='movimientos_stock'
          AND column_name='costo_unitario'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].data_type).toBe('numeric')
    expect(rows[0].numeric_precision).toBe(12)
    expect(rows[0].numeric_scale).toBe(2)
    // Nullable a propósito: los movimientos que no son un ingreso no tienen
    // costo, y los que ya existían tampoco.
    expect(rows[0].is_nullable).toBe('YES')
  })

  it('guarda la desactivación del artículo como timestamptz nullable', async () => {
    const { rows } = await cliente.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='articulos'
          AND column_name='desactivado_en'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].data_type).toBe('timestamp with time zone')
    expect(rows[0].is_nullable).toBe('YES')
  })

  it('arranca el correlativo del SKU en 1 para todo tenant', async () => {
    const { rows } = await cliente.query(
      `SELECT column_default, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tenants'
          AND column_name='proximo_sku_articulo'`,
    )
    expect(rows).toHaveLength(1)
    // Con default y NOT NULL: un tenant que ya existía tiene que quedar en 1,
    // no en null, o la primera alta de ese local explota.
    expect(rows[0].column_default).toBe('1')
    expect(rows[0].is_nullable).toBe('NO')
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

describe('la migración de idempotencia de la venta', () => {
  it('guarda la clave como columna nullable', async () => {
    const { rows } = await cliente.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='ventas'
          AND column_name='clave_idempotencia'`,
    )
    expect(rows).toHaveLength(1)
    // Nullable a propósito: en Postgres el índice único de abajo deja pasar
    // varios NULL, así que un llamador sin clave no choca contra nada.
    expect(rows[0].is_nullable).toBe('YES')
  })

  it('la unicidad es POR TENANT y no global', async () => {
    const { rows } = await cliente.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='ventas'
          AND indexdef ILIKE '%clave_idempotencia%'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].indexdef).toMatch(/UNIQUE/)
    // Sin tenant_id en el índice, la clave de un negocio bloquearía la de otro.
    expect(rows[0].indexdef).toMatch(/tenant_id/)
  })

  it('deja convivir varias ventas sin clave en el mismo tenant', async () => {
    // La razón por la que la columna es nullable, ejercitada: dos NULL no
    // chocan. Si esto falla, la columna quedó NOT NULL o el índice está mal.
    const t = await crearTenantCrudo(`idem-${Date.now()}`)
    const u = await cliente.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'V', 'v@idem.test', 'EMPLEADO', now(), now())
       RETURNING id`,
      [t],
    )
    for (const numero of [1, 2]) {
      await cliente.query(
        `INSERT INTO ventas (id, tenant_id, numero, usuario_id, total, creado_en)
         VALUES (gen_random_uuid(), $1, $2, $3, 100.00, now())`,
        [t, numero, u.rows[0].id],
      )
    }
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM ventas WHERE tenant_id = $1`, [t],
    )
    expect(rows[0].n).toBe(2)
  })
})
