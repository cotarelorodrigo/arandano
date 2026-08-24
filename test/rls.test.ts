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

  // Las cuatro tablas del ciclo de ventas, probadas por COMPORTAMIENTO y no por
  // forma. `test/rls-cobertura.test.ts` las cubre estructuralmente —que exista
  // la policy, con USING y con WITH CHECK— y eso no mira la EXPRESIÓN: con la
  // policy de `ventas` puesta en `USING (true) WITH CHECK (true)` sus dos
  // asserts siguen en verde mientras el tenant A lee las ventas del tenant B.
  // Está medido. Lo único que distingue una policy que aísla de una que
  // simplemente existe es leer filas con la GUC de otro, que es lo que hace esto.
  //
  // Los fixtures los inserta el OWNER —que está exento de RLS— y viven adentro
  // del test y no en el beforeAll: así el test no depende de que ningún otro
  // haya corrido antes, que es lo que hace que "1 fila" signifique algo.
  describe('las tablas que guardan la plata', () => {
    const TABLAS = ['ventas', 'venta_items', 'pagos', 'movimientos_stock'] as const
    let usuarioB: string
    let articuloB: string
    let ventaB: string

    beforeAll(async () => {
      const u = await owner.query(
        `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Vendedor de B', 'ventas-b@ejemplo.com', 'EMPLEADO', now(), now())
         RETURNING id`,
        [tenantB],
      )
      usuarioB = u.rows[0].id

      const a = await owner.query(
        `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'SKU-VENTAS-B', 'Vendible de B', 'PRODUCTO', 100.00, 10, now(), now())
         RETURNING id`,
        [tenantB],
      )
      articuloB = a.rows[0].id

      const v = await owner.query(
        `INSERT INTO ventas (id, tenant_id, numero, usuario_id, total, creado_en)
         VALUES (gen_random_uuid(), $1, 1, $2, 100.00, now())
         RETURNING id`,
        [tenantB, usuarioB],
      )
      ventaB = v.rows[0].id

      await owner.query(
        `INSERT INTO venta_items (id, tenant_id, venta_id, articulo_id, descripcion, cantidad, precio_unitario)
         VALUES (gen_random_uuid(), $1, $2, $3, 'Vendible de B', 1, 100.00)`,
        [tenantB, ventaB, articuloB],
      )
      await owner.query(
        `INSERT INTO pagos (id, tenant_id, venta_id, medio, moneda, monto, cotizacion, creado_en)
         VALUES (gen_random_uuid(), $1, $2, 'EFECTIVO', 'ARS', 100.00, 1.0000, now())`,
        [tenantB, ventaB],
      )
      await owner.query(
        `INSERT INTO movimientos_stock (id, tenant_id, articulo_id, delta, motivo, venta_id, usuario_id, creado_en)
         VALUES (gen_random_uuid(), $1, $2, -1, 'VENTA', $3, $4, now())`,
        [tenantB, articuloB, ventaB, usuarioB],
      )
    })

    for (const tabla of TABLAS) {
      it(`${tabla}: el otro tenant no ve la fila, y su dueño sí`, async () => {
        const { rows: deA } = await comoTenant(tenantA, `SELECT 1 FROM ${tabla}`)
        expect(deA, `${tabla} filtró filas de otro tenant`).toHaveLength(0)

        // La mitad que falta, igual que en el caso de articulos/users de más
        // arriba: sin ella, una tabla vacía para todos —policy que compara la
        // columna que no es, o filas que nunca se insertaron— daría 0 y el test
        // quedaría verde sin haber probado ningún aislamiento.
        const { rows: deB } = await comoTenant(tenantB, `SELECT 1 FROM ${tabla}`)
        expect(deB, `${tabla} no es legible por su propio tenant`).toHaveLength(1)
      })
    }

    it('ventas: rechaza insertar con el tenant_id de otro', async () => {
      await expect(
        comoTenant(
          tenantA,
          `INSERT INTO ventas (id, tenant_id, numero, usuario_id, total, creado_en)
           VALUES (gen_random_uuid(), $1, 999, $2, 1.00, now())`,
          [tenantB, usuarioB],
        ),
      ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
    })

    it('venta_items: rechaza insertar con el tenant_id de otro', async () => {
      await expect(
        comoTenant(
          tenantA,
          `INSERT INTO venta_items (id, tenant_id, venta_id, articulo_id, descripcion, cantidad, precio_unitario)
           VALUES (gen_random_uuid(), $1, $2, $3, 'Infiltrado', 1, 1.00)`,
          [tenantB, ventaB, articuloB],
        ),
      ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
    })

    it('pagos: rechaza insertar con el tenant_id de otro', async () => {
      await expect(
        comoTenant(
          tenantA,
          `INSERT INTO pagos (id, tenant_id, venta_id, medio, moneda, monto, cotizacion, creado_en)
           VALUES (gen_random_uuid(), $1, $2, 'EFECTIVO', 'ARS', 1.00, 1.0000, now())`,
          [tenantB, ventaB],
        ),
      ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
    })

    it('movimientos_stock: rechaza insertar con el tenant_id de otro', async () => {
      await expect(
        comoTenant(
          tenantA,
          `INSERT INTO movimientos_stock (id, tenant_id, articulo_id, delta, motivo, usuario_id, creado_en)
           VALUES (gen_random_uuid(), $1, $2, 1, 'AJUSTE', $3, now())`,
          [tenantB, articuloB, usuarioB],
        ),
      ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
    })
  })

  // Las tres tablas de Better Auth, probadas por COMPORTAMIENTO y no sólo por
  // forma, igual que las de ventas más arriba: guardan tokens de sesión y
  // hashes de contraseña, así que son las últimas que deberían quedar cubiertas
  // sólo por test/rls-cobertura.test.ts (que verifica que la policy EXISTA, no
  // que compare contra la columna correcta).
  describe('las tablas de autenticación', () => {
    const TABLAS_AUTH = ['sessions', 'accounts', 'verifications'] as const
    let usuarioB: string

    beforeAll(async () => {
      // sessions.user_id y accounts.user_id son FK a users: la fila necesita
      // un usuario del mismo tenant. verifications no tiene esa FK.
      const u = await owner.query(
        `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Usuario de B', 'auth-b@ejemplo.com', 'EMPLEADO', now(), now())
         RETURNING id`,
        [tenantB],
      )
      usuarioB = u.rows[0].id

      await owner.query(
        `INSERT INTO sessions (id, tenant_id, user_id, token, expira_en, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, $2, 'token-de-b', now() + interval '1 day', now(), now())`,
        [tenantB, usuarioB],
      )
      await owner.query(
        `INSERT INTO accounts (id, tenant_id, user_id, account_id, provider_id, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, $2, 'cuenta-de-b', 'credential', now(), now())`,
        [tenantB, usuarioB],
      )
      await owner.query(
        `INSERT INTO verifications (id, tenant_id, identifier, value, expira_en, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'verificacion-de-b', 'valor', now() + interval '1 day', now(), now())`,
        [tenantB],
      )
    })

    for (const tabla of TABLAS_AUTH) {
      it(`${tabla}: el otro tenant no ve la fila, y su dueño sí`, async () => {
        const { rows: deA } = await comoTenant(tenantA, `SELECT 1 FROM ${tabla}`)
        expect(deA, `${tabla} filtró filas de otro tenant`).toHaveLength(0)

        // La mitad que falta, igual que en los otros bloques: sin ella, una
        // tabla vacía para todos (policy que compara la columna que no es, o
        // filas que nunca se insertaron) daría 0 y el test quedaría verde sin
        // haber probado ningún aislamiento.
        const { rows: deB } = await comoTenant(tenantB, `SELECT 1 FROM ${tabla}`)
        expect(deB, `${tabla} no es legible por su propio tenant`).toHaveLength(1)
      })
    }

    it('sessions: rechaza insertar con el tenant_id de otro', async () => {
      await expect(
        comoTenant(
          tenantA,
          `INSERT INTO sessions (id, tenant_id, user_id, token, expira_en, creado_en, actualizado_en)
           VALUES (gen_random_uuid(), $1, $2, 'token-infiltrado', now() + interval '1 day', now(), now())`,
          [tenantB, usuarioB],
        ),
      ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
    })

    it('accounts: rechaza insertar con el tenant_id de otro', async () => {
      await expect(
        comoTenant(
          tenantA,
          `INSERT INTO accounts (id, tenant_id, user_id, account_id, provider_id, creado_en, actualizado_en)
           VALUES (gen_random_uuid(), $1, $2, 'cuenta-infiltrada', 'credential', now(), now())`,
          [tenantB, usuarioB],
        ),
      ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
    })

    it('verifications: rechaza insertar con el tenant_id de otro', async () => {
      await expect(
        comoTenant(
          tenantA,
          `INSERT INTO verifications (id, tenant_id, identifier, value, expira_en, creado_en, actualizado_en)
           VALUES (gen_random_uuid(), $1, 'verificacion-infiltrada', 'valor', now() + interval '1 day', now(), now())`,
          [tenantB],
        ),
      ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
    })
  })

  // I2 de la review de Task 3: `lib/caja/abrir-cerrar.test.ts` sólo probaba
  // "dos tenants pueden tener cada uno su caja abierta" con `not.toBeNull()`
  // de los dos lados — eso pasa igual si la policy estuviera rota y A viera
  // la caja de B, porque `cajaAbierta(tenantA)` tampoco da null en ESE caso.
  // `cajaAbierta` y `cerrarCaja` no filtran por tenantId en su propio `where`
  // —`prismaParaTenant` no inyecta filtros en lecturas, a propósito—, así que
  // el aislamiento de `cajas` depende ENTERAMENTE del texto de la policy. Acá
  // se prueba ese texto, por comportamiento, igual que el resto del archivo.
  describe('la caja', () => {
    let usuarioB: string
    let cajaB: string

    beforeAll(async () => {
      const u = await owner.query(
        `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Dueño de B', 'caja-b@ejemplo.com', 'DUENO', now(), now())
         RETURNING id`,
        [tenantB],
      )
      usuarioB = u.rows[0].id

      const c = await owner.query(
        `INSERT INTO cajas (id, tenant_id, abierta_en, abierta_por_id, saldo_inicial, creado_en)
         VALUES (gen_random_uuid(), $1, now(), $2, 9000.00, now())
         RETURNING id`,
        [tenantB, usuarioB],
      )
      cajaB = c.rows[0].id
    })

    it('cajas: el otro tenant no ve la fila, y su dueño sí', async () => {
      const { rows: deA } = await comoTenant(tenantA, 'SELECT 1 FROM cajas')
      expect(deA, 'cajas filtró filas de otro tenant').toHaveLength(0)

      // La mitad que falta, igual que en los otros bloques: sin ella, una
      // tabla vacía para todos (policy que compara la columna que no es, o
      // la fila que nunca se insertó) daría 0 y el test quedaría verde sin
      // haber probado ningún aislamiento.
      const { rows: deB } = await comoTenant(tenantB, 'SELECT 1 FROM cajas')
      expect(deB, 'cajas no es legible por su propio tenant').toHaveLength(1)
    })

    it('cajas: rechaza insertar con el tenant_id de otro', async () => {
      await expect(
        comoTenant(
          tenantA,
          `INSERT INTO cajas (id, tenant_id, abierta_en, abierta_por_id, saldo_inicial, creado_en)
           VALUES (gen_random_uuid(), $1, now(), $2, 1.00, now())`,
          [tenantB, usuarioB],
        ),
      ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
    })

    it('cajas: A no puede cerrar (UPDATE) la caja de B — cero filas afectadas', async () => {
      const { rowCount } = await comoTenant(
        tenantA,
        `UPDATE cajas SET cerrada_en = now(), cerrada_por_id = $1 WHERE id = $2`,
        [usuarioB, cajaB],
      )
      expect(rowCount, 'el UPDATE de A afectó una fila que no es suya').toBe(0)

      // Y no es que el UPDATE haya fallado en silencio por otro motivo: la
      // caja de B sigue exactamente como estaba, vista con el owner.
      const { rows } = await owner.query('SELECT cerrada_en FROM cajas WHERE id = $1', [cajaB])
      expect(rows[0].cerrada_en).toBeNull()
    })

    it('cajas: A no puede borrar (DELETE) la caja de B — cero filas afectadas', async () => {
      const { rowCount } = await comoTenant(tenantA, `DELETE FROM cajas WHERE id = $1`, [cajaB])
      expect(rowCount, 'el DELETE de A afectó una fila que no es suya').toBe(0)

      const { rows } = await owner.query('SELECT 1 FROM cajas WHERE id = $1', [cajaB])
      expect(rows, 'la caja de B desapareció').toHaveLength(1)
    })
  })

  describe('las categorías', () => {
    let raizB: string

    beforeAll(async () => {
      const c = await owner.query(
        `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Celulares', now(), now())
         RETURNING id`,
        [tenantB],
      )
      raizB = c.rows[0].id
    })

    it('categorias: el otro tenant no ve la fila, y su dueño sí', async () => {
      const { rows: deA } = await comoTenant(tenantA, 'SELECT 1 FROM categorias')
      expect(deA, 'categorias filtró filas de otro tenant').toHaveLength(0)

      // La mitad que falta, igual que en los otros bloques: sin ella, una
      // tabla vacía para todos daría 0 y el test quedaría verde sin haber
      // probado ningún aislamiento.
      const { rows: deB } = await comoTenant(tenantB, 'SELECT 1 FROM categorias')
      expect(deB, 'categorias no es legible por su propio tenant').toHaveLength(1)
    })

    it('categorias: rechaza insertar con el tenant_id de otro', async () => {
      await expect(
        comoTenant(
          tenantA,
          `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
           VALUES (gen_random_uuid(), $1, 'Robada', now(), now())`,
          [tenantB],
        ),
      ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
    })

    it('categorias: A no puede renombrar (UPDATE) la categoría de B', async () => {
      const { rowCount } = await comoTenant(
        tenantA,
        `UPDATE categorias SET nombre = 'Renombrada' WHERE id = $1`,
        [raizB],
      )
      expect(rowCount, 'el UPDATE de A afectó una fila que no es suya').toBe(0)

      const { rows } = await owner.query('SELECT nombre FROM categorias WHERE id = $1', [raizB])
      expect(rows[0].nombre).toBe('Celulares')
    })

    it('categorias: A no puede borrar (DELETE) la categoría de B', async () => {
      const { rowCount } = await comoTenant(tenantA, `DELETE FROM categorias WHERE id = $1`, [raizB])
      expect(rowCount, 'el DELETE de A afectó una fila que no es suya').toBe(0)

      const { rows } = await owner.query('SELECT 1 FROM categorias WHERE id = $1', [raizB])
      expect(rows, 'la categoría de B desapareció').toHaveLength(1)
    })

    /**
     * **Las FK no las frena RLS, y este caso lo deja escrito en vez de fingir
     * lo contrario.**
     *
     * Un artículo de A SÍ puede apuntar a una categoría de B por SQL crudo: la
     * verificación de integridad referencial de Postgres corre por fuera de
     * las policies, así que el `INSERT` encuentra la fila de B aunque el
     * `SELECT` de esa misma sesión no la vea. No es propio de esta tabla — es
     * el comportamiento de TODAS las FK del schema (`cajas.abierta_por_id`,
     * `movimientos_stock.articulo_id`, `ventas.cliente_id`), ninguna de las
     * cuales es compuesta con `tenant_id`. La primera versión de este caso
     * esperaba un rechazo y falló; el rechazo era la expectativa equivocada.
     *
     * Lo que SÍ protege RLS, y es lo que este caso afirma: aunque esa fila
     * exista, **el nombre de la categoría de B no se lee desde A**. El JOIN se
     * queda sin la fila y la pantalla muestra un artículo sin categoría, no la
     * categoría del local de al lado. Eso es lo que importa: el aislamiento es
     * de datos visibles, no de integridad referencial.
     *
     * Desde la aplicación esa fila no se puede crear: `asegurarCategoria`
     * resuelve siempre dentro del tenant de la transacción, así que el id que
     * devuelve es de ese tenant o de ninguno.
     */
    it('categorias: una referencia cruzada no filtra el nombre a la pantalla', async () => {
      // Con el owner, que es el único camino por el que esta fila puede
      // existir — RLS no lo impide, pero ningún código de la app lo produce.
      const { rows: creado } = await owner.query(
        `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, categoria_id, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'A-7777', 'Prestado', 'PRODUCTO', 1000, 0, $2, now(), now())
         RETURNING id`,
        [tenantA, raizB],
      )

      const { rows } = await comoTenant(
        tenantA,
        `SELECT a.nombre AS articulo, c.nombre AS categoria
           FROM articulos a
           LEFT JOIN categorias c ON c.id = a.categoria_id
          WHERE a.id = $1`,
        [creado[0].id],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].articulo).toBe('Prestado')
      expect(rows[0].categoria, 'el nombre de la categoría de B se filtró a A').toBeNull()
    })
  })
})
