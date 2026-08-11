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

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ enTransaccionDeTenant } = await import('@/lib/tenant/transaccion'))
  ;({ ajustarStock, ingresarStock, corregirStock } = await import('@/lib/inventario/stock'))

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
