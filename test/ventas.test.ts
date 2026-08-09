import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

// Import DINÁMICO de todo lo que arrastre `lib/db.ts`: ese módulo construye su
// Pool de pg AL IMPORTARSE, leyendo DATABASE_URL, que no está seteada
// globalmente en el repo. Un import estático moriría con ECONNREFUSED contra
// localhost:5432 antes de que corra un solo test. Es el patrón que ya usan
// lib/tenant/prisma.test.ts y lib/tenant/transaccion.test.ts.
//
// `Prisma` y `ErrorDeVenta` sí van estáticos: no tocan la base.
let enTransaccionDeTenant: typeof import('@/lib/tenant/transaccion').enTransaccionDeTenant
let crearVenta: typeof import('@/lib/ventas/crear').crearVenta

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client
let tenantId: string
let usuarioId: string
let remera: string
let servicio: string
// Sólo se toca a través del motor: es lo que hace significativo el test de
// reconciliación. Ver su comentario más abajo.
let recon: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ enTransaccionDeTenant } = await import('@/lib/tenant/transaccion'))
  ;({ crearVenta } = await import('@/lib/ventas/crear'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `ventas-${Date.now()}`)

  const u = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Vendedor', 'v@x.test', 'EMPLEADO', now(), now())
     RETURNING id`,
    [tenantId],
  )
  usuarioId = u.rows[0].id

  const a = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'REM-1', 'Remera', 'PRODUCTO', 1000.00, 1000, now(), now()),
            (gen_random_uuid(), $1, 'SRV-1', 'Arreglo', 'SERVICIO', 500.00, 0, now(), now()),
            (gen_random_uuid(), $1, 'REC-1', 'Reconciliable', 'PRODUCTO', 100.00, 0, now(), now())
     RETURNING id, sku`,
    [tenantId],
  )
  const porSku = (sku: string) =>
    a.rows.find((r: { sku: string }) => r.sku === sku).id
  remera = porSku('REM-1')
  servicio = porSku('SRV-1')
  recon = porSku('REC-1')
})

afterAll(async () => {
  await owner.end()
})

/** El stock actual de un artículo, leído desde la transacción del tenant. */
async function stockDe(articuloId: string): Promise<string> {
  return enTransaccionDeTenant(tenantId, async (tx) => {
    const a = await tx.articulo.findUniqueOrThrow({ where: { id: articuloId } })
    return a.stock.toString()
  })
}

describe('crearVenta', () => {
  it('crea la venta, descuenta el stock y deja el movimiento', async () => {
    const antes = await stockDe(remera)

    const { id, numero } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('2') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('2000'), cotizacion: d('1') }],
    })

    expect(numero).toBeGreaterThan(0)

    const { venta, movs } = await enTransaccionDeTenant(tenantId, async (tx) => ({
      venta: await tx.venta.findUniqueOrThrow({
        where: { id },
        include: { items: true, pagos: true },
      }),
      movs: await tx.movimientoStock.findMany({ where: { ventaId: id } }),
    }))

    expect(venta.total.toString()).toBe('2000')
    expect(venta.items).toHaveLength(1)
    expect(venta.pagos).toHaveLength(1)
    expect(movs).toHaveLength(1)
    expect(movs[0].delta.toString()).toBe('-2')
    expect(movs[0].motivo).toBe('VENTA')

    expect(new Prisma.Decimal(await stockDe(remera)).toString()).toBe(
      new Prisma.Decimal(antes).minus(2).toString(),
    )
  })

  it('congela el precio: cambiarlo después no cambia lo cobrado', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), cotizacion: d('1') }],
    })

    await owner.query(`UPDATE articulos SET precio = 9999 WHERE id = $1`, [remera])

    const item = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.ventaItem.findFirstOrThrow({ where: { ventaId: id } }),
    )
    expect(item.precioUnitario.toString()).toBe('1000')
    expect(item.descripcion).toBe('Remera')

    await owner.query(`UPDATE articulos SET precio = 1000 WHERE id = $1`, [remera])
  })

  it('un servicio no mueve stock', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('500'), cotizacion: d('1') }],
    })

    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { ventaId: id } }),
    )
    expect(movs).toHaveLength(0)
  })

  it('acepta pago partido en dos monedas', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [
        { medio: 'EFECTIVO', moneda: 'ARS', monto: d('500'), cotizacion: d('1') },
        { medio: 'EFECTIVO', moneda: 'USD', monto: d('0.5'), cotizacion: d('1000') },
      ],
    })

    const pagos = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.pago.findMany({ where: { ventaId: id } }),
    )
    expect(pagos).toHaveLength(2)
  })

  it('rechaza si los pagos no cierran, y no deja nada a medias', async () => {
    const stockAntes = await stockDe(remera)
    const numeroAntes = await enTransaccionDeTenant(tenantId, async (tx) =>
      (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })).proximoNumeroVenta,
    )

    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('999'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'PAGOS_NO_CIERRAN' })

    // Atomicidad: ni stock, ni contador.
    expect(await stockDe(remera)).toBe(stockAntes)
    const numeroDespues = await enTransaccionDeTenant(tenantId, async (tx) =>
      (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })).proximoNumeroVenta,
    )
    expect(numeroDespues).toBe(numeroAntes)
  })

  // El caso de arriba prueba PAGOS_NO_CIERRAN, que se valida ANTES de escribir
  // nada — así que "no se movió nada" es cierto ahí incluso sin transacción, y
  // no ejercita ningún rollback real. Éste sí: un clienteId inexistente pasa
  // la validación de pagos y explota recién en `venta.create`, por la FK
  // `Restrict` de `Venta.cliente` — después de que `proximoNumero` ya
  // incrementó el contador dentro de la misma transacción. Si el rollback no
  // funcionara, el contador quedaría avanzado con la venta fallida.
  it('un fallo después de incrementar el contador también revierte todo', async () => {
    const numeroAntes = await enTransaccionDeTenant(tenantId, async (tx) =>
      (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })).proximoNumeroVenta,
    )

    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        clienteId: '00000000-0000-7000-8000-0000000000ff',
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), cotizacion: d('1') }],
      }),
    ).rejects.toThrow()

    const numeroDespues = await enTransaccionDeTenant(tenantId, async (tx) =>
      (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })).proximoNumeroVenta,
    )
    expect(numeroDespues).toBe(numeroAntes)
  })

  it('rechaza un artículo que no existe', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: '00000000-0000-7000-8000-000000000000', cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
  })

  it('rechaza una venta sin ítems', async () => {
    await expect(
      crearVenta({ tenantId, usuarioId, items: [], pagos: [] }),
    ).rejects.toMatchObject({ codigo: 'SIN_ITEMS' })
  })

  it('rechaza cantidad cero', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('0') }],
        pagos: [],
      }),
    ).rejects.toMatchObject({ codigo: 'CANTIDAD_INVALIDA' })
  })

  it('rechaza cantidad negativa', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('-1') }],
        pagos: [],
      }),
    ).rejects.toMatchObject({ codigo: 'CANTIDAD_INVALIDA' })
  })

  // Decisión de negocio explícita del spec: el cliente está parado en el
  // mostrador y la plata es real. Arranca poniendo el stock en 1 con un
  // UPDATE directo: sin eso, el test depende de que los casos anteriores
  // hayan dejado a `remera` con poco stock, y reordenarlos lo rompería sin
  // que el motor tenga ningún bug.
  it('permite dejar el stock negativo', async () => {
    await owner.query(`UPDATE articulos SET stock = 1 WHERE id = $1`, [remera])

    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1000') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000000'), cotizacion: d('1') }],
    })
    expect(id).toBeTruthy()
    expect(new Prisma.Decimal(await stockDe(remera)).isNegative()).toBe(true)
  })

  // La prueba del UPDATE relativo. Con `SET stock = $leido - $cantidad` una de
  // las dos se pierde y este test lo detecta.
  it('dos ventas simultáneas del mismo artículo no se pisan', async () => {
    const antes = new Prisma.Decimal(await stockDe(remera))
    const venta = () =>
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), cotizacion: d('1') }],
      })

    await Promise.all([venta(), venta(), venta(), venta()])

    expect(new Prisma.Decimal(await stockDe(remera)).toString()).toBe(
      antes.minus(4).toString(),
    )
  })

  // La reconciliación que justifica tener el campo denormalizado. Es un test y
  // no una intención — ver el comentario de `Articulo.stock` en
  // `prisma/schema.prisma`, que promete exactamente esto.
  //
  // Corre sobre `recon`, un artículo que SÓLO se toca a través del motor.
  // Usar `remera` no serviría: otros tests le escriben el stock con UPDATE
  // directo para armar su escenario, y eso rompe la invariante a propósito —
  // el test daría rojo por el andamiaje del test, no por un bug del motor.
  //
  // Versión reducida de la del plan maestro: la original arrancaba con un
  // `ajustarStock` (INGRESO de 40) antes de la venta, pero esa función es
  // interfaz de la Task 5 (`lib/ventas/anular.ts`, todavía no existe), no de
  // ésta — el plan la dejó escrita adentro del bloque de la Task 4 por error
  // de edición. `recon` ya arranca en stock 0, así que un solo `crearVenta`
  // alcanza para cerrar la invariante sin tocar interfaz ajena: la Task 5
  // puede sumarle después el paso de `ajustarStock` con dos líneas más.
  it('el stock cierra contra la suma de sus movimientos', async () => {
    await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: recon, cantidad: d('7.5') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('750'), cotizacion: d('1') }],
    })

    const { stock, suma } = await enTransaccionDeTenant(tenantId, async (tx) => {
      const a = await tx.articulo.findUniqueOrThrow({ where: { id: recon } })
      const agg = await tx.movimientoStock.aggregate({
        where: { articuloId: recon },
        _sum: { delta: true },
      })
      return { stock: a.stock, suma: agg._sum.delta ?? new Prisma.Decimal(0) }
    })
    expect(stock.toString()).toBe(suma.toString())
    expect(stock.toString()).toBe('-7.5')
  })

  it('los números de venta son correlativos y sin huecos', async () => {
    const numeros = await enTransaccionDeTenant(tenantId, async (tx) =>
      (await tx.venta.findMany({ orderBy: { numero: 'asc' } })).map((v) => v.numero),
    )
    expect(numeros).toEqual(numeros.map((_, i) => i + 1))
  })
})
