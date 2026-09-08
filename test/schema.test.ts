import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'

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

describe('categorias', () => {
  it('la tabla existe con las columnas en snake_case', async () => {
    const { rows } = await cliente.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'categorias'
        ORDER BY column_name`,
    )
    const columnas = rows.map((r) => r.column_name)
    expect(columnas).toEqual(['actualizado_en', 'creado_en', 'id', 'nombre', 'padre_id', 'tenant_id'])
  })

  it('articulos tiene la FK a categorias, nullable', async () => {
    const { rows } = await cliente.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='articulos' AND column_name='categoria_id'`,
    )
    expect(rows[0].is_nullable).toBe('YES')
  })

  // Sin el índice PARCIAL, dos raíces homónimas pasan: en Postgres NULL <>
  // NULL, así que el @@unique de Prisma —que lleva padre_id— no las alcanza.
  // Este caso es lo único que separa "el árbol tiene una Celulares" de "tiene
  // tres".
  it('rechaza dos raíces con el mismo nombre en el mismo tenant', async () => {
    const t = await crearTenantCrudo('cat-raiz-unica')
    await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Celulares', now(), now())`,
      [t],
    )
    await expect(
      cliente.query(
        `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Celulares', now(), now())`,
        [t],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  // La otra mitad del mismo índice: sin `tenant_id` adentro, el local de al
  // lado no podría tener su propia "Fundas".
  it('pero la misma raíz convive en dos tenants distintos', async () => {
    const a = await crearTenantCrudo('cat-raiz-a')
    const b = await crearTenantCrudo('cat-raiz-b')
    for (const t of [a, b]) {
      await cliente.query(
        `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Fundas', now(), now())`,
        [t],
      )
    }
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM categorias WHERE nombre = 'Fundas' AND tenant_id = ANY($1::uuid[])`,
      [[a, b]],
    )
    expect(rows[0].n).toBe(2)
  })

  it('rechaza dos hijas con el mismo nombre bajo el mismo padre', async () => {
    const t = await crearTenantCrudo('cat-hija-unica')
    const { rows } = await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Celulares', now(), now()) RETURNING id`,
      [t],
    )
    const padre = rows[0].id
    await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Samsung', $2, now(), now())`,
      [t, padre],
    )
    await expect(
      cliente.query(
        `INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Samsung', $2, now(), now())`,
        [t, padre],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  // ...pero la misma marca bajo OTRO rubro es otra categoría, y tiene que
  // entrar. Es la mitad que prueba que el @@unique lleva padre_id adentro.
  it('y deja la misma marca bajo dos padres distintos', async () => {
    const t = await crearTenantCrudo('cat-marca-dos-padres')
    const padres: string[] = []
    for (const rubro of ['Fundas', 'Vidrios templados']) {
      const { rows } = await cliente.query(
        `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, $2, now(), now()) RETURNING id`,
        [t, rubro],
      )
      padres.push(rows[0].id)
    }
    for (const padre of padres) {
      await cliente.query(
        `INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Samsung', $2, now(), now())`,
        [t, padre],
      )
    }
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM categorias WHERE tenant_id = $1 AND nombre = 'Samsung'`,
      [t],
    )
    expect(rows[0].n).toBe(2)
  })

  // Restrict y no Cascade: borrar "Celulares" no puede llevarse puesto el
  // trabajo de clasificar todas sus marcas.
  it('no deja borrar una categoría con hijas', async () => {
    const t = await crearTenantCrudo('cat-con-hijas')
    const { rows } = await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Celulares', now(), now()) RETURNING id`,
      [t],
    )
    const padre = rows[0].id
    await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Motorola', $2, now(), now())`,
      [t, padre],
    )
    await expect(
      cliente.query(`DELETE FROM categorias WHERE id = $1`, [padre]),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('no deja borrar una categoría con artículos', async () => {
    const t = await crearTenantCrudo('cat-con-articulos')
    const { rows } = await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Cables', now(), now()) RETURNING id`,
      [t],
    )
    const cat = rows[0].id
    await cliente.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, categoria_id, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'A-9001', 'Cable USB-C', 'PRODUCTO', 1000, 0, $2, now(), now())`,
      [t, cat],
    )
    await expect(
      cliente.query(`DELETE FROM categorias WHERE id = $1`, [cat]),
    ).rejects.toMatchObject({ code: '23503' })
  })

  // El tenant se borra entero y se lleva su árbol: es la única cascada del
  // modelo, la misma que ya tiene toda tabla del núcleo.
  it('borrar el tenant se lleva sus categorías', async () => {
    const t = await crearTenantCrudo('cat-cascada')
    await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Cargadores', now(), now())`,
      [t],
    )
    await cliente.query(`DELETE FROM tenants WHERE id = $1`, [t])
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM categorias WHERE tenant_id = $1`, [t],
    )
    expect(rows[0].n).toBe(0)
  })
})

describe('el borrado de un artículo', () => {
  /** Un tenant con un usuario, listo para colgarle artículos. `crearTenantCrudo`
   *  ya vive en este archivo, así que el escenario sólo agrega lo suyo. */
  async function escenario(nombre: string) {
    const tenantId = await crearTenantCrudo(`${nombre}-${Date.now()}`)
    const u = await cliente.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Dueño', $2, 'DUENO', now(), now()) RETURNING id`,
      [tenantId, `d-${tenantId}@borrado.test`],
    )
    const a = await cliente.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'BORR-1', 'Duplicado', 'PRODUCTO', 100.00, 1, now(), now())
       RETURNING id`,
      [tenantId],
    )
    return { tenantId, usuarioId: u.rows[0].id as string, articuloId: a.rows[0].id as string }
  }

  async function conMovimiento(e: { tenantId: string; usuarioId: string; articuloId: string }) {
    await cliente.query(
      `INSERT INTO movimientos_stock
         (id, tenant_id, articulo_id, usuario_id, motivo, delta, creado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, 'INGRESO', 1, now())`,
      [e.tenantId, e.articuloId, e.usuarioId],
    )
  }

  async function conUnidad(e: { tenantId: string; usuarioId: string; articuloId: string }) {
    const { rows } = await cliente.query(
      `INSERT INTO unidades_articulo
         (id, tenant_id, articulo_id, imei, ingresada_por_id, ingresada_en, creado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now()) RETURNING id`,
      [e.tenantId, e.articuloId, `IMEI-${crypto.randomUUID()}`, e.usuarioId],
    )
    return rows[0].id as string
  }

  async function cuantos(tabla: string, articuloId: string) {
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM ${tabla} WHERE articulo_id = $1`,
      [articuloId],
    )
    return rows[0].n as number
  }

  /**
   * Una consulta con el rol de la APP y la GUC del tenant puesta, que es como
   * corre en producción.
   *
   * El `BEGIN`/`COMMIT` no es ceremonia: el tercer argumento de `set_config`
   * la hace LOCAL A LA TRANSACCIÓN, así que sin transacción explícita el
   * autocommit se la lleva antes de la sentencia siguiente y la consulta corre
   * sin tenant — donde RLS falla cerrado y devuelve cero filas. Un test así
   * pasa sin probar nada. Es el mismo `comoTenant` de `test/rls.test.ts`.
   */
  async function comoApp(tenantId: string, sql: string, params: unknown[] = []) {
    const app = new Client({ connectionString: urlApp() })
    await app.connect()
    try {
      await app.query('BEGIN')
      await app.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [tenantId])
      const res = await app.query(sql, params)
      await app.query('COMMIT')
      return res
    } finally {
      await app.end()
    }
  }

  it('se lleva sus movimientos de stock', async () => {
    const e = await escenario('borr-movs')
    await conMovimiento(e)
    await cliente.query(`DELETE FROM articulos WHERE id = $1`, [e.articuloId])
    expect(await cuantos('movimientos_stock', e.articuloId)).toBe(0)
  })

  it('se lleva sus unidades', async () => {
    const e = await escenario('borr-unis')
    await conUnidad(e)
    await cliente.query(`DELETE FROM articulos WHERE id = $1`, [e.articuloId])
    expect(await cuantos('unidades_articulo', e.articuloId)).toBe(0)
  })

  // El caso que prueba que `movimientos_stock.unidad_id` tenía que dejar de
  // ser RESTRICT: acá las dos filas se van en la MISMA sentencia, y RESTRICT
  // —que se evalúa inmediato, sin esperar al final— abortaría el borrado por
  // una fila que se está yendo igual.
  it('se lleva un movimiento que apunta a una unidad, las dos a la vez', async () => {
    const e = await escenario('borr-mov-uni')
    const unidadId = await conUnidad(e)
    await cliente.query(
      `INSERT INTO movimientos_stock
         (id, tenant_id, articulo_id, unidad_id, usuario_id, motivo, delta, creado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'AJUSTE', -1, now())`,
      [e.tenantId, e.articuloId, unidadId, e.usuarioId],
    )
    await cliente.query(`DELETE FROM articulos WHERE id = $1`, [e.articuloId])
    expect(await cuantos('movimientos_stock', e.articuloId)).toBe(0)
    expect(await cuantos('unidades_articulo', e.articuloId)).toBe(0)
  })

  // El guard, y la razón por la que `venta_items` NO pasa a Cascade: la
  // historia de la plata no se toca. Que lo sostenga la base y no un `if` es
  // lo que hace que la regla valga aunque el chequeo de la aplicación falle.
  it('la base se niega si el artículo tiene una línea de venta', async () => {
    const e = await escenario('borr-vendido')
    const v = await cliente.query(
      `INSERT INTO ventas (id, tenant_id, numero, usuario_id, total, creado_en)
       VALUES (gen_random_uuid(), $1, 1, $2, 100.00, now()) RETURNING id`,
      [e.tenantId, e.usuarioId],
    )
    await cliente.query(
      `INSERT INTO venta_items
         (id, tenant_id, venta_id, articulo_id, descripcion, cantidad, precio_unitario)
       VALUES (gen_random_uuid(), $1, $2, $3, 'Duplicado', 1, 100.00)`,
      [e.tenantId, v.rows[0].id, e.articuloId],
    )
    await expect(
      cliente.query(`DELETE FROM articulos WHERE id = $1`, [e.articuloId]),
    ).rejects.toThrow(/foreign key|llave foránea/i)
  })

  // La mitad que de verdad importa y que el owner no puede probar: el rol de
  // la app NO tiene DELETE sobre movimientos_stock (setup-db-roles.sh lo
  // revoca), y sin embargo la cascada se los lleva. Las acciones de FK las
  // ejecuta el sistema y no pasan por el chequeo de privilegios del rol que
  // llama — es exactamente la puerta que este ciclo abre a propósito.
  it('el rol de la app borra el artículo y la cascada se lleva el libro que él no puede tocar', async () => {
    const e = await escenario('borr-app')
    await conMovimiento(e)

    // El REVOKE se comprueba en su propia conexión: un statement que falla
    // aborta la transacción entera, así que meterlo en la misma que el DELETE
    // bueno dejaría a ése sin poder correr.
    const sinPermiso = new Client({ connectionString: urlApp() })
    await sinPermiso.connect()
    try {
      await expect(
        sinPermiso.query(`DELETE FROM movimientos_stock WHERE articulo_id = $1`, [e.articuloId]),
      ).rejects.toThrow(/permission denied|denegado/i)
    } finally {
      await sinPermiso.end()
    }

    await comoApp(e.tenantId, `DELETE FROM articulos WHERE id = $1`, [e.articuloId])
    expect(await cuantos('movimientos_stock', e.articuloId)).toBe(0)
  })

  // RLS es lo único que impide borrar el artículo de otro local, y sigue en
  // pie: la cascada no es una vía de entrada porque la fila que se borra —la
  // de `articulos`— está protegida por su policy.
  it('el rol de la app no borra el artículo de otro tenant', async () => {
    const mio = await escenario('borr-mio')
    const ajeno = await escenario('borr-ajeno')

    const r = await comoApp(mio.tenantId, `DELETE FROM articulos WHERE id = $1`, [ajeno.articuloId])
    expect(r.rowCount, 'RLS lo esconde, así que el DELETE no encuentra fila').toBe(0)

    const { rows } = await cliente.query(`SELECT count(*)::int AS n FROM articulos WHERE id = $1`, [
      ajeno.articuloId,
    ])
    expect(rows[0].n).toBe(1)
  })
})

describe('la migración del detalle de venta', () => {
  it('guarda el detalle como texto nullable', async () => {
    const r = await cliente.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'ventas' AND column_name = 'detalle'`,
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].data_type).toBe('text')
    // Nullable y SIN default: `NULL` dice "acá no se anotó nada", que es lo que
    // pasa en la enorme mayoría de las ventas. Un `default ''` daría una
    // tercera respuesta indistinguible de las otras dos.
    expect(r.rows[0].is_nullable).toBe('YES')
    expect(r.rows[0].column_default).toBeNull()
  })
})
