import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'
import { ErrorDeInventario } from '@/lib/inventario/errores'

// Import DINÁMICO de todo lo que arrastre lib/db.ts: ese módulo construye su
// Pool AL IMPORTARSE, leyendo DATABASE_URL, que no está seteada globalmente.
// Mismo patrón que test/ventas.test.ts.
let enTransaccionDeTenant: typeof import('@/lib/tenant/transaccion').enTransaccionDeTenant
let ajustarStock: typeof import('@/lib/inventario/stock').ajustarStock
let ingresarStock: typeof import('@/lib/inventario/stock').ingresarStock
let corregirStock: typeof import('@/lib/inventario/stock').corregirStock
let crearArticulo: typeof import('@/lib/inventario/articulos').crearArticulo
let editarArticulo: typeof import('@/lib/inventario/articulos').editarArticulo
let desactivarArticulo: typeof import('@/lib/inventario/articulos').desactivarArticulo
let reactivarArticulo: typeof import('@/lib/inventario/articulos').reactivarArticulo

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client
let tenantId: string
let usuarioId: string
let remera: string
let servicio: string
let otroTenantId: string
let usuarioAjeno: string

async function stockDe(articuloId: string): Promise<string> {
  const { rows } = await owner.query(`SELECT stock FROM articulos WHERE id = $1`, [articuloId])
  return new Prisma.Decimal(rows[0].stock).toString()
}

/** La rama del árbol a la que quedó colgado un artículo, o `null` si no cuelga
 *  de ninguna. Se lee con el OWNER, así que ve el árbol entero: lo que se está
 *  probando es qué escribió el motor, no qué deja ver RLS —eso es
 *  test/rls.test.ts—. */
async function categoriaDe(
  articuloId: string,
): Promise<{ nombre: string; padre: string | null } | null> {
  const { rows } = await owner.query(
    `SELECT c.nombre, p.nombre AS padre
       FROM articulos a
       JOIN categorias c ON c.id = a.categoria_id
       LEFT JOIN categorias p ON p.id = c.padre_id
      WHERE a.id = $1`,
    [articuloId],
  )
  return rows.length === 0 ? null : { nombre: rows[0].nombre, padre: rows[0].padre }
}

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ enTransaccionDeTenant } = await import('@/lib/tenant/transaccion'))
  ;({ ajustarStock, ingresarStock, corregirStock } = await import('@/lib/inventario/stock'))
  ;({ crearArticulo, editarArticulo, desactivarArticulo, reactivarArticulo } = await import(
    '@/lib/inventario/articulos'
  ))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `inventario-${Date.now()}`)

  const u = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Vendedor', 'v@inv.test', 'EMPLEADO', now(), now())
     RETURNING id`,
    [tenantId],
  )
  usuarioId = u.rows[0].id

  const a = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'REM-1', 'Remera', 'PRODUCTO', 1000.00, 0, now(), now()),
            (gen_random_uuid(), $1, 'SRV-1', 'Arreglo', 'SERVICIO', 500.00, 0, now(), now())
     RETURNING id, sku`,
    [tenantId],
  )
  const porSku = (sku: string) => a.rows.find((r: { sku: string }) => r.sku === sku).id
  remera = porSku('REM-1')
  servicio = porSku('SRV-1')

  // El otro negocio. Sus filas existen y las FKs de Postgres las aceptarían
  // —sus triggers corren como dueño de la tabla, exento de RLS—, así que el
  // chequeo de pertenencia tiene que ser del motor.
  otroTenantId = await crearTenant(owner, `inventario-otro-${Date.now()}`)
  const ua = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Ajeno', 'a@inv.test', 'EMPLEADO', now(), now())
     RETURNING id`,
    [otroTenantId],
  )
  usuarioAjeno = ua.rows[0].id
})

afterAll(async () => {
  await owner.end()
})

describe('ajustarStock', () => {
  it('un ingreso suma y queda registrado con su nota', async () => {
    const antes = new Prisma.Decimal(await stockDe(remera))

    await ajustarStock({
      tenantId,
      articuloId: remera,
      delta: d('25'),
      motivo: 'INGRESO',
      usuarioId,
      nota: 'compra al proveedor',
    })

    expect(await stockDe(remera)).toBe(antes.plus(25).toString())

    const mov = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findFirst({
        where: { articuloId: remera, motivo: 'INGRESO' },
        orderBy: { creadoEn: 'desc' },
      }),
    )
    expect(mov?.nota).toBe('compra al proveedor')
    expect(mov?.ventaId).toBeNull()
  })

  it('un ajuste negativo devuelve a cero un stock negativo', async () => {
    await owner.query(`UPDATE articulos SET stock = -5 WHERE id = $1`, [remera])
    await ajustarStock({
      tenantId, articuloId: remera, delta: d('5'), motivo: 'AJUSTE', usuarioId,
    })
    expect(await stockDe(remera)).toBe('0')
  })

  it('rechaza un artículo que no existe', async () => {
    await expect(
      ajustarStock({
        tenantId,
        articuloId: '00000000-0000-7000-8000-000000000000',
        delta: d('1'),
        motivo: 'AJUSTE',
        usuarioId,
      }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
  })

  it('rechaza un usuarioId de otro tenant', async () => {
    await expect(
      ajustarStock({ tenantId, articuloId: remera, delta: d('1'), motivo: 'AJUSTE', usuarioId: usuarioAjeno }),
    ).rejects.toMatchObject({ codigo: 'USUARIO_INEXISTENTE' })
  })

  // El tipo de `motivo` sólo protege a los llamadores tipados. Un body JSON ya
  // parseado pasa 'VENTA' sin que TypeScript se entere, y eso crearía un
  // movimiento VENTA con `ventaId` null — rompiendo la invariante sobre la que
  // está construido el filtro de `anularVenta`. El `as never` emula al
  // llamador sin tipos, que es el único que puede hacerlo.
  it('rechaza un motivo que no le corresponde, como VENTA', async () => {
    await expect(
      ajustarStock({ tenantId, articuloId: remera, delta: d('1'), motivo: 'VENTA' as never, usuarioId }),
    ).rejects.toMatchObject({ codigo: 'MOTIVO_INVALIDO' })

    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { articuloId: remera, motivo: 'VENTA', ventaId: null } }),
    )
    expect(movs, 'quedó un movimiento VENTA sin venta asociada').toHaveLength(0)
  })

  it('rechaza un delta con más decimales de los que la columna guarda', async () => {
    await expect(
      ajustarStock({ tenantId, articuloId: remera, delta: d('1.0005'), motivo: 'INGRESO', usuarioId }),
    ).rejects.toMatchObject({ codigo: 'ESCALA_EXCEDIDA' })
  })

  // El cambio de comportamiento de este ciclo: antes esta función dejaba
  // mover el stock de un servicio, creando un número que después nadie
  // descuenta. Ahora el chequeo vive en el helper compartido.
  it('rechaza mover el stock de un servicio', async () => {
    await expect(
      ajustarStock({ tenantId, articuloId: servicio, delta: d('1'), motivo: 'INGRESO', usuarioId }),
    ).rejects.toMatchObject({ codigo: 'SERVICIO_SIN_STOCK' })
  })
})

describe('ingresarStock', () => {
  it('suma, deja el movimiento con motivo INGRESO y guarda el costo', async () => {
    const antes = new Prisma.Decimal(await stockDe(remera))

    await ingresarStock({
      tenantId,
      articuloId: remera,
      cantidad: d('10'),
      usuarioId,
      costoUnitario: d('620.50'),
      nota: 'factura 0001-00012345',
    })

    expect(await stockDe(remera)).toBe(antes.plus(10).toString())

    const mov = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findFirst({
        where: { articuloId: remera, motivo: 'INGRESO' },
        orderBy: { creadoEn: 'desc' },
      }),
    )
    expect(mov?.delta.toString()).toBe('10')
    expect(mov?.costoUnitario?.toString()).toBe('620.5')
    expect(mov?.nota).toBe('factura 0001-00012345')
    expect(mov?.ventaId).toBeNull()
  })

  it('el costo es opcional: sin él, el movimiento queda con costo null', async () => {
    await ingresarStock({ tenantId, articuloId: remera, cantidad: d('1'), usuarioId })

    const mov = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findFirst({
        where: { articuloId: remera, motivo: 'INGRESO' },
        orderBy: { creadoEn: 'desc' },
      }),
    )
    expect(mov?.costoUnitario).toBeNull()
  })

  it('rechaza una cantidad que no suma nada', async () => {
    for (const mala of ['0', '-3']) {
      await expect(
        ingresarStock({ tenantId, articuloId: remera, cantidad: d(mala), usuarioId }),
        `aceptó ${mala}`,
      ).rejects.toMatchObject({ codigo: 'CANTIDAD_INVALIDA' })
    }
  })

  it('rechaza un costo negativo y uno con más decimales de los que se guardan', async () => {
    await expect(
      ingresarStock({ tenantId, articuloId: remera, cantidad: d('1'), usuarioId, costoUnitario: d('-1') }),
    ).rejects.toMatchObject({ codigo: 'COSTO_INVALIDO' })
    await expect(
      ingresarStock({ tenantId, articuloId: remera, cantidad: d('1'), usuarioId, costoUnitario: d('1.005') }),
    ).rejects.toMatchObject({ codigo: 'ESCALA_EXCEDIDA' })
  })

  // Un servicio no tiene stock y el motor de ventas ni siquiera le genera
  // movimientos: darle stock crearía un número que después nadie descuenta.
  it('rechaza mover el stock de un servicio', async () => {
    await expect(
      ingresarStock({ tenantId, articuloId: servicio, cantidad: d('1'), usuarioId }),
    ).rejects.toMatchObject({ codigo: 'SERVICIO_SIN_STOCK' })
  })

  // El único fallo que no se puede anticipar con una validación previa. Tiene
  // que salir como ErrorDeInventario y no como ErrorDeVenta: la pantalla filtra
  // por esa clase, y un error de otra le llega como 500.
  it('un desborde de la columna sale como error de inventario', async () => {
    const promesa = ingresarStock({
      tenantId, articuloId: remera, cantidad: d('999999999999'), usuarioId,
    })
    await expect(promesa).rejects.toMatchObject({ codigo: 'FUERA_DE_RANGO' })
    await expect(promesa).rejects.toBeInstanceOf(ErrorDeInventario)
  })

  // Un id que no es uuid no puede nombrar ninguna fila, así que la respuesta
  // honesta es la misma que para uno de otro tenant. Sin esta traducción,
  // Prisma tira P2007 crudo y la pantalla que filtra por ErrorDeInventario lo
  // relanza como 500 — desde algo que alguien escribió a mano. Pasa por acá y
  // no antes: con `usuarioId` válido, `exigirUsuario` no ataja el camino, así
  // que lo que se ejercita es exactamente el `findUnique` de
  // `exigirArticuloConStock`.
  it('un id malformado sale como artículo inexistente, no como error crudo', async () => {
    await expect(
      ingresarStock({ tenantId, articuloId: 'no-es-uuid', cantidad: d('1'), usuarioId }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
  })
})

describe('corregirStock', () => {
  it('lleva el stock a lo que la persona contó, con el delta que falta', async () => {
    await owner.query(`UPDATE articulos SET stock = 12 WHERE id = $1`, [remera])

    await corregirStock({
      tenantId, articuloId: remera, stockContado: d('9'), usuarioId, nota: 'conteo del lunes',
    })

    expect(await stockDe(remera)).toBe('9')

    const mov = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findFirst({
        where: { articuloId: remera, motivo: 'AJUSTE' },
        orderBy: { creadoEn: 'desc' },
      }),
    )
    expect(mov?.delta.toString()).toBe('-3')
    expect(mov?.nota).toBe('conteo del lunes')
    // El costo es del ingreso, no de la corrección: acá no hay factura.
    expect(mov?.costoUnitario).toBeNull()
  })

  it('un conteo que confirma lo que había no escribe ningún movimiento', async () => {
    await owner.query(`UPDATE articulos SET stock = 7 WHERE id = $1`, [remera])
    const { rows: antes } = await owner.query(
      `SELECT count(*)::int AS n FROM movimientos_stock WHERE articulo_id = $1`, [remera],
    )

    await corregirStock({ tenantId, articuloId: remera, stockContado: d('7'), usuarioId })

    const { rows: despues } = await owner.query(
      `SELECT count(*)::int AS n FROM movimientos_stock WHERE articulo_id = $1`, [remera],
    )
    expect(despues[0].n, 'escribió un movimiento de delta cero').toBe(antes[0].n)
    expect(await stockDe(remera)).toBe('7')
  })

  it('un conteo puede subir el stock, no sólo bajarlo', async () => {
    await owner.query(`UPDATE articulos SET stock = 2 WHERE id = $1`, [remera])
    await corregirStock({ tenantId, articuloId: remera, stockContado: d('5'), usuarioId })
    expect(await stockDe(remera)).toBe('5')
  })

  it('rechaza un conteo negativo: no se pueden contar menos de cero unidades', async () => {
    await expect(
      corregirStock({ tenantId, articuloId: remera, stockContado: d('-1'), usuarioId }),
    ).rejects.toMatchObject({ codigo: 'CANTIDAD_INVALIDA' })
  })

  it('rechaza corregir el stock de un servicio', async () => {
    await expect(
      corregirStock({ tenantId, articuloId: servicio, stockContado: d('3'), usuarioId }),
    ).rejects.toMatchObject({ codigo: 'SERVICIO_SIN_STOCK' })
  })
})

// La invariante de todo el motor, ejercitada por las TRES vías de movimiento.
// Si sólo probara una, no distinguiría un bug que afecte a las otras.
describe('la invariante del stock', () => {
  it('el stock del artículo es la suma de sus movimientos', async () => {
    const propio = await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'INV-1', 'Reconciliable', 'PRODUCTO', 100.00, 0, now(), now())
       RETURNING id`,
      [tenantId],
    )
    const articuloId = propio.rows[0].id

    await ingresarStock({ tenantId, articuloId, cantidad: d('40'), usuarioId, costoUnitario: d('50') })
    await corregirStock({ tenantId, articuloId, stockContado: d('37.5'), usuarioId })
    await ajustarStock({ tenantId, articuloId, delta: d('2.25'), motivo: 'INGRESO', usuarioId })

    const { rows } = await owner.query(
      `SELECT coalesce(sum(delta), 0) AS suma FROM movimientos_stock WHERE articulo_id = $1`,
      [articuloId],
    )
    expect(await stockDe(articuloId)).toBe(new Prisma.Decimal(rows[0].suma).toString())
  })
})

describe('crearArticulo', () => {
  it('autogenera el SKU correlativo cuando no se escribe uno', async () => {
    const uno = await crearArticulo({
      tenantId, usuarioId, nombre: 'Vidrio templado', tipo: 'PRODUCTO', precio: d('3500'),
    })
    const dos = await crearArticulo({
      tenantId, usuarioId, nombre: 'Funda silicona', tipo: 'PRODUCTO', precio: d('2800'),
    })

    expect(uno.sku).toMatch(/^A-\d{4}$/)
    // Correlativo de verdad: el segundo es el siguiente, no otro al azar.
    const n = (sku: string) => Number(sku.slice(2))
    expect(n(dos.sku)).toBe(n(uno.sku) + 1)
  })

  it('respeta el SKU que se escribe a mano', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Cargador 20W', tipo: 'PRODUCTO', precio: d('9000'),
      sku: '7798123456789',
    })
    expect(a.sku).toBe('7798123456789')
  })

  it('rechaza un SKU ya usado en vez de inventar otro', async () => {
    await crearArticulo({
      tenantId, usuarioId, nombre: 'Auricular', tipo: 'PRODUCTO', precio: d('12000'), sku: 'AUR-1',
    })
    await expect(
      crearArticulo({
        tenantId, usuarioId, nombre: 'Otro auricular', tipo: 'PRODUCTO', precio: d('13000'), sku: 'AUR-1',
      }),
    ).rejects.toMatchObject({ codigo: 'SKU_REPETIDO' })
  })

  // El borde real: alguien tipeó a mano un código con la forma del
  // autogenerado. La unicidad de la base lo atrapa y el alta sigue de largo
  // con el siguiente número, en vez de fallarle a quien no hizo nada malo.
  it('salta el correlativo si alguien ya tipeó ese código a mano', async () => {
    const proximo = await owner.query(
      `SELECT proximo_sku_articulo AS n FROM tenants WHERE id = $1`, [tenantId],
    )
    const ocupado = `A-${String(proximo.rows[0].n).padStart(4, '0')}`
    await crearArticulo({
      tenantId, usuarioId, nombre: 'Ocupa el correlativo', tipo: 'PRODUCTO', precio: d('100'),
      sku: ocupado,
    })

    const siguiente = await crearArticulo({
      tenantId, usuarioId, nombre: 'El que sigue', tipo: 'PRODUCTO', precio: d('100'),
    })
    expect(siguiente.sku).not.toBe(ocupado)
    expect(siguiente.sku).toMatch(/^A-\d{4}$/)
  })

  it('el stock inicial nace como movimiento, no como número suelto', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Pantalla A52', tipo: 'PRODUCTO', precio: d('85000'),
      stockInicial: d('4'), costoUnitario: d('52000'),
    })

    expect(await stockDe(a.id)).toBe('4')

    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { articuloId: a.id } }),
    )
    expect(movs).toHaveLength(1)
    expect(movs[0].motivo).toBe('INGRESO')
    expect(movs[0].delta.toString()).toBe('4')
    expect(movs[0].costoUnitario?.toString()).toBe('52000')
  })

  it('guarda la categoría cuando se manda', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Vidrio templado 9H', tipo: 'PRODUCTO', precio: d('12000'),
      categoria: 'Accesorios · Protección',
    })
    const { rows } = await owner.query(`SELECT categoria FROM articulos WHERE id = $1`, [a.id])
    expect(rows[0].categoria).toBe('Accesorios · Protección')
  })

  // Nullable a propósito (CLAUDE.md): un artículo sin categoría no puede
  // romper nada, ni en el alta ni después, en el listado o la ficha.
  it('sin categoría, la columna queda en null y no en cadena vacía', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Sin categoría', tipo: 'PRODUCTO', precio: d('1000'),
    })
    const { rows } = await owner.query(`SELECT categoria FROM articulos WHERE id = $1`, [a.id])
    expect(rows[0].categoria).toBeNull()
  })

  // Espacios sueltos tipeados por error no deberían quedar como si fueran un
  // valor real: mismo criterio que exigirNombre.
  it('una categoría de sólo espacios se guarda como null', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Categoría en blanco', tipo: 'PRODUCTO', precio: d('1000'),
      categoria: '   ',
    })
    const { rows } = await owner.query(`SELECT categoria FROM articulos WHERE id = $1`, [a.id])
    expect(rows[0].categoria).toBeNull()
  })

  it('sin stock inicial no escribe ningún movimiento', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Sin stock todavía', tipo: 'PRODUCTO', precio: d('1000'),
    })
    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { articuloId: a.id } }),
    )
    expect(movs).toHaveLength(0)
    expect(await stockDe(a.id)).toBe('0')
  })

  it('rechaza stock inicial en un servicio', async () => {
    await expect(
      crearArticulo({
        tenantId, usuarioId, nombre: 'Reparación', tipo: 'SERVICIO', precio: d('15000'),
        stockInicial: d('3'),
      }),
    ).rejects.toMatchObject({ codigo: 'SERVICIO_SIN_STOCK' })
  })

  it('crea un servicio sin stock, que es lo normal', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Cambio de módulo', tipo: 'SERVICIO', precio: d('18000'),
    })
    expect(await stockDe(a.id)).toBe('0')
  })

  it('rechaza un nombre vacío y un precio inválido', async () => {
    await expect(
      crearArticulo({ tenantId, usuarioId, nombre: '   ', tipo: 'PRODUCTO', precio: d('100') }),
    ).rejects.toMatchObject({ codigo: 'NOMBRE_VACIO' })
    await expect(
      crearArticulo({ tenantId, usuarioId, nombre: 'X', tipo: 'PRODUCTO', precio: d('-1') }),
    ).rejects.toMatchObject({ codigo: 'PRECIO_INVALIDO' })
    await expect(
      crearArticulo({ tenantId, usuarioId, nombre: 'X', tipo: 'PRODUCTO', precio: d('1.005') }),
    ).rejects.toMatchObject({ codigo: 'ESCALA_EXCEDIDA' })
  })

  it('no deja crear con el usuario de otro tenant', async () => {
    await expect(
      crearArticulo({
        tenantId, usuarioId: usuarioAjeno, nombre: 'Ajeno', tipo: 'PRODUCTO', precio: d('100'),
      }),
    ).rejects.toMatchObject({ codigo: 'USUARIO_INEXISTENTE' })
  })

  it('el mismo SKU puede existir en dos negocios distintos', async () => {
    await crearArticulo({
      tenantId, usuarioId, nombre: 'Compartido', tipo: 'PRODUCTO', precio: d('100'), sku: 'DUP-1',
    })
    const ajeno = await owner.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Dueño otro', 'd@otro.test', 'DUENO', now(), now())
       RETURNING id`,
      [otroTenantId],
    )
    await expect(
      crearArticulo({
        tenantId: otroTenantId, usuarioId: ajeno.rows[0].id, nombre: 'Compartido',
        tipo: 'PRODUCTO', precio: d('100'), sku: 'DUP-1',
      }),
    ).resolves.toMatchObject({ sku: 'DUP-1' })
  })

  // El mismo desborde que ya cubre `ingresarStock` en test/inventario.test.ts,
  // pero disparado por el `increment` del stock inicial en el alta: el precio
  // y el stock inicial validan escala pero no magnitud, así que un valor
  // desmedido pasa la validación y sólo Postgres lo frena con P2020. Tiene que
  // traducirse a `ErrorDeInventario`, no llegar como 500: la pantalla de
  // inventario filtra por esa clase para decidir qué mostrar.
  it('un desborde del stock inicial sale como error de inventario, no como 500', async () => {
    const promesa = crearArticulo({
      tenantId, usuarioId, nombre: 'Desborde', tipo: 'PRODUCTO', precio: d('100'),
      stockInicial: d('999999999999'),
    })
    await expect(promesa).rejects.toMatchObject({ codigo: 'FUERA_DE_RANGO' })
    await expect(promesa).rejects.toBeInstanceOf(ErrorDeInventario)
  })
})

describe('editarArticulo, desactivarArticulo y reactivarArticulo', () => {
  it('cambia nombre, SKU y precio', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Nombre viejo', tipo: 'PRODUCTO', precio: d('100'),
    })
    await editarArticulo({
      tenantId, articuloId: a.id, nombre: 'Nombre nuevo', sku: 'NUE-1', precio: d('250.75'),
    })

    const { rows } = await owner.query(
      `SELECT nombre, sku, precio, tipo FROM articulos WHERE id = $1`, [a.id],
    )
    expect(rows[0].nombre).toBe('Nombre nuevo')
    expect(rows[0].sku).toBe('NUE-1')
    expect(new Prisma.Decimal(rows[0].precio).toString()).toBe('250.75')
    // El tipo NO se edita: cambiarlo dejaría stock huérfano que el motor de
    // ventas ya no descuenta ni explica. No hay parámetro para hacerlo.
    expect(rows[0].tipo).toBe('PRODUCTO')
  })

  it('edita la categoría, incluido vaciarla de vuelta a null', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Con categoría', tipo: 'PRODUCTO', precio: d('100'),
      categoria: 'Repuestos',
    })
    await editarArticulo({
      tenantId, articuloId: a.id, nombre: 'Con categoría', sku: a.sku, precio: d('100'),
      categoria: 'Audio',
    })
    const { rows } = await owner.query(`SELECT categoria FROM articulos WHERE id = $1`, [a.id])
    expect(rows[0].categoria).toBe('Audio')

    await editarArticulo({
      tenantId, articuloId: a.id, nombre: 'Con categoría', sku: a.sku, precio: d('100'),
      categoria: '',
    })
    const vacia = await owner.query(`SELECT categoria FROM articulos WHERE id = $1`, [a.id])
    expect(vacia.rows[0].categoria).toBeNull()
  })

  it('rechaza mover el SKU a uno ya usado', async () => {
    await crearArticulo({
      tenantId, usuarioId, nombre: 'Ocupa', tipo: 'PRODUCTO', precio: d('100'), sku: 'OCU-1',
    })
    const otro = await crearArticulo({
      tenantId, usuarioId, nombre: 'Quiere ocupar', tipo: 'PRODUCTO', precio: d('100'),
    })
    await expect(
      editarArticulo({ tenantId, articuloId: otro.id, nombre: 'Quiere ocupar', sku: 'OCU-1', precio: d('100') }),
    ).rejects.toMatchObject({ codigo: 'SKU_REPETIDO' })
  })

  it('rechaza un SKU vacío: la columna es obligatoria', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Con sku', tipo: 'PRODUCTO', precio: d('100'),
    })
    await expect(
      editarArticulo({ tenantId, articuloId: a.id, nombre: 'Con sku', sku: '  ', precio: d('100') }),
    ).rejects.toMatchObject({ codigo: 'SKU_VACIO' })
  })

  it('desactiva y reactiva sin tocar el historial', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Discontinuado', tipo: 'PRODUCTO', precio: d('100'),
      stockInicial: d('2'),
    })

    await desactivarArticulo({ tenantId, articuloId: a.id })
    const baja = await owner.query(`SELECT desactivado_en FROM articulos WHERE id = $1`, [a.id])
    expect(baja.rows[0].desactivado_en).not.toBeNull()

    const movs = await owner.query(
      `SELECT count(*)::int AS n FROM movimientos_stock WHERE articulo_id = $1`, [a.id],
    )
    expect(movs.rows[0].n, 'la baja se llevó puesto el historial').toBe(1)

    await reactivarArticulo({ tenantId, articuloId: a.id })
    const alta = await owner.query(`SELECT desactivado_en FROM articulos WHERE id = $1`, [a.id])
    expect(alta.rows[0].desactivado_en).toBeNull()
  })

  it('rechaza editar un artículo que no existe en este tenant', async () => {
    await expect(
      editarArticulo({
        tenantId,
        articuloId: '00000000-0000-7000-8000-000000000000',
        nombre: 'X', sku: 'X-1', precio: d('1'),
      }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
  })

  // Mismo caso que en `ingresarStock`, pero por el otro camino: acá la
  // consulta es `updateMany`, no `findUnique`, y Postgres la rechaza con el
  // mismo P2007 antes de que el `count === 0` de más arriba tenga chance de
  // correr. `desactivarArticulo` y `reactivarArticulo` comparten el mismo
  // `marcarBaja`, así que un solo caso alcanza para las tres funciones.
  it('un id malformado sale como artículo inexistente en editarArticulo y en desactivarArticulo', async () => {
    await expect(
      editarArticulo({ tenantId, articuloId: 'no-es-uuid', nombre: 'X', sku: 'X-1', precio: d('1') }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
    await expect(
      desactivarArticulo({ tenantId, articuloId: 'no-es-uuid' }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
  })
})


/**
 * El árbol de categorías se arma desde el texto que el formulario ya manda —
 * ninguna pantalla cambió en este ciclo. Es lo que evita que el ciclo de la UI
 * tenga que correr un segundo backfill para juntar lo cargado en el medio.
 */
describe('el árbol de categorías', () => {
  it('el alta arma la rama desde el texto', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Funda Galaxy A52', tipo: 'PRODUCTO', precio: d('9000'),
      categoria: 'Fundas · Samsung',
    })
    expect(await categoriaDe(a.id)).toEqual({ nombre: 'Samsung', padre: 'Fundas' })
  })

  // El texto NO deja de escribirse, y eso es lo que sostiene el rollback: el
  // código de la imagen anterior lee esta columna y encuentra el dato. Si este
  // caso se cae, el contract se adelantó a su deploy.
  it('y sigue escribiendo el texto igual que antes', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Funda Moto G54', tipo: 'PRODUCTO', precio: d('8000'),
      categoria: 'Fundas · Motorola',
    })
    const { rows } = await owner.query(`SELECT categoria FROM articulos WHERE id = $1`, [a.id])
    expect(rows[0].categoria).toBe('Fundas · Motorola')
  })

  // "Cables" y "Cargadores" los nombró el cliente sueltos, sin marca: un
  // artículo colgado de una raíz es un caso normal, no un dato a medio cargar.
  it('una categoría sin marca cuelga de la raíz, y eso es válido', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Cable USB-C 1m', tipo: 'PRODUCTO', precio: d('4000'),
      categoria: 'Cables',
    })
    expect(await categoriaDe(a.id)).toEqual({ nombre: 'Cables', padre: null })
  })

  it('sin categoría no crea ninguna fila y categoria_id queda null', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Sin clasificar', tipo: 'PRODUCTO', precio: d('1000'),
    })
    expect(await categoriaDe(a.id)).toBeNull()
    const { rows } = await owner.query(
      `SELECT categoria_id FROM articulos WHERE id = $1`, [a.id],
    )
    expect(rows[0].categoria_id).toBeNull()
  })

  it('una categoría de sólo espacios tampoco arma nada', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'En blanco del árbol', tipo: 'PRODUCTO', precio: d('1000'),
      categoria: '   ',
    })
    expect(await categoriaDe(a.id)).toBeNull()
  })

  // Dos altas de la misma categoría tienen que REUSAR la fila. Si no, el árbol
  // crece una rama por artículo y la pantalla del ciclo siguiente es ilegible.
  it('dos artículos de la misma categoría comparten la fila', async () => {
    const uno = await crearArticulo({
      tenantId, usuarioId, nombre: 'Vidrio A52', tipo: 'PRODUCTO', precio: d('5000'),
      categoria: 'Vidrios templados · Samsung',
    })
    const dos = await crearArticulo({
      tenantId, usuarioId, nombre: 'Vidrio A54', tipo: 'PRODUCTO', precio: d('5500'),
      categoria: 'Vidrios templados · Samsung',
    })
    const { rows } = await owner.query(
      `SELECT id, categoria_id FROM articulos WHERE id = ANY($1::uuid[])`,
      [[uno.id, dos.id]],
    )
    expect(rows[0].categoria_id).toBe(rows[1].categoria_id)

    const { rows: cuenta } = await owner.query(
      `SELECT count(*)::int AS n FROM categorias
        WHERE tenant_id = $1 AND nombre = 'Vidrios templados' AND padre_id IS NULL`,
      [tenantId],
    )
    expect(cuenta[0].n).toBe(1)
  })

  // La misma marca bajo dos rubros distintos son DOS filas, no una: "Samsung"
  // de Fundas y "Samsung" de Vidrios templados no son la misma categoría, y
  // fundirlas haría que filtrar por una trajera los artículos de la otra.
  it('la misma marca bajo dos rubros son dos hijas distintas', async () => {
    const { rows } = await owner.query(
      `SELECT p.nombre AS padre FROM categorias c
         JOIN categorias p ON p.id = c.padre_id
        WHERE c.tenant_id = $1 AND c.nombre = 'Samsung' ORDER BY p.nombre`,
      [tenantId],
    )
    expect(rows.map((r) => r.padre)).toEqual(['Fundas', 'Vidrios templados'])
  })

  it('el tercer nivel se pliega dentro de la hija, sin perder texto', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Funda con tres niveles', tipo: 'PRODUCTO', precio: d('7000'),
      categoria: 'Accesorios · Fundas · Samsung',
    })
    expect(await categoriaDe(a.id)).toEqual({ nombre: 'Fundas · Samsung', padre: 'Accesorios' })
  })

  it('la edición mueve el artículo de rama', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Cargador 33W', tipo: 'PRODUCTO', precio: d('12000'),
      categoria: 'Cables',
    })
    await editarArticulo({
      tenantId, articuloId: a.id, nombre: 'Cargador 33W', sku: a.sku, precio: d('12000'),
      categoria: 'Cargadores · Xiaomi',
    })
    expect(await categoriaDe(a.id)).toEqual({ nombre: 'Xiaomi', padre: 'Cargadores' })
  })

  // Vaciar el campo despeja las dos columnas a la vez. Dejar `categoria_id`
  // apuntando a la rama vieja con el texto ya en null sería el peor de los dos
  // mundos: la pantalla de hoy diría "sin categoría" y el árbol del ciclo
  // siguiente lo seguiría contando adentro de "Cables".
  it('y vaciar la categoría al editar despeja las dos columnas', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Se despeja', tipo: 'PRODUCTO', precio: d('1000'),
      categoria: 'Cables',
    })
    await editarArticulo({
      tenantId, articuloId: a.id, nombre: 'Se despeja', sku: a.sku, precio: d('1000'),
      categoria: '',
    })
    expect(await categoriaDe(a.id)).toBeNull()
    const { rows } = await owner.query(
      `SELECT categoria, categoria_id FROM articulos WHERE id = $1`, [a.id],
    )
    expect(rows[0].categoria).toBeNull()
    expect(rows[0].categoria_id).toBeNull()
  })

  // El árbol es POR TENANT: el local de al lado que use la misma categoría
  // tiene su propia fila. Lo garantiza el índice único, que lleva tenant_id
  // adentro; esto lo ejercita por el camino real, el del motor.
  it('el árbol de otro tenant no se comparte', async () => {
    const ajeno = await crearArticulo({
      tenantId: otroTenantId, usuarioId: usuarioAjeno, nombre: 'Funda del vecino',
      tipo: 'PRODUCTO', precio: d('9000'), categoria: 'Fundas · Samsung',
    })
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM categorias
        WHERE nombre = 'Fundas' AND padre_id IS NULL AND tenant_id = ANY($1::uuid[])`,
      [[tenantId, otroTenantId]],
    )
    expect(rows[0].n).toBe(2)
    expect(await categoriaDe(ajeno.id)).toEqual({ nombre: 'Samsung', padre: 'Fundas' })
  })
})
