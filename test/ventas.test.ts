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
let anularVenta: typeof import('@/lib/ventas/anular').anularVenta
let ajustarStock: typeof import('@/lib/inventario/stock').ajustarStock
let buscarArticulosVendibles: typeof import('@/lib/ventas/buscar').buscarArticulosVendibles
let ultimaCotizacionUsd: typeof import('@/lib/ventas/buscar').ultimaCotizacionUsd

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client
let tenantId: string
let usuarioId: string
let remera: string
let servicio: string
// Sólo se toca a través del motor: es lo que hace significativo el test de
// reconciliación. Ver su comentario más abajo.
let recon: string
// Dedicados, para que el escenario que cada uno necesita —un stock al borde del
// desborde, un artículo que cambia de tipo— no le mueva el piso a los demás.
let desbordable: string
let mutante: string
let clientePropio: string
// El otro negocio. Existe para probar que sus filas NO son usables desde acá:
// las FKs de Postgres las aceptan (sus triggers corren como dueño de la tabla,
// exento de RLS) y el daño lo sufre él, no quien las manda.
let otroTenantId: string
let clienteAjeno: string
let usuarioAjeno: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ enTransaccionDeTenant } = await import('@/lib/tenant/transaccion'))
  ;({ crearVenta } = await import('@/lib/ventas/crear'))
  ;({ anularVenta } = await import('@/lib/ventas/anular'))
  ;({ ajustarStock } = await import('@/lib/inventario/stock'))
  ;({ buscarArticulosVendibles, ultimaCotizacionUsd } = await import('@/lib/ventas/buscar'))

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
            (gen_random_uuid(), $1, 'REC-1', 'Reconciliable', 'PRODUCTO', 100.00, 0, now(), now()),
            (gen_random_uuid(), $1, 'DES-1', 'Desbordable', 'PRODUCTO', 1000.00, 0, now(), now()),
            (gen_random_uuid(), $1, 'MUT-1', 'Mutante', 'PRODUCTO', 100.00, 10, now(), now())
     RETURNING id, sku`,
    [tenantId],
  )
  const porSku = (sku: string) =>
    a.rows.find((r: { sku: string }) => r.sku === sku).id
  remera = porSku('REM-1')
  servicio = porSku('SRV-1')
  recon = porSku('REC-1')
  desbordable = porSku('DES-1')
  mutante = porSku('MUT-1')

  const c = await owner.query(
    `INSERT INTO clientes (id, tenant_id, nombre, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Cliente propio', now(), now())
     RETURNING id`,
    [tenantId],
  )
  clientePropio = c.rows[0].id

  otroTenantId = await crearTenant(owner, `ventas-otro-${Date.now()}`)
  const ca = await owner.query(
    `INSERT INTO clientes (id, tenant_id, nombre, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Cliente del otro', now(), now())
     RETURNING id`,
    [otroTenantId],
  )
  clienteAjeno = ca.rows[0].id
  const ua = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Vendedor del otro', 'v@otro.test', 'EMPLEADO', now(), now())
     RETURNING id`,
    [otroTenantId],
  )
  usuarioAjeno = ua.rows[0].id
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
  // no ejercita ningún rollback real. Éste sí.
  //
  // POR QUÉ EL DESBORDE DEL STOCK Y NO OTRA COSA. Este test usaba un `clienteId`
  // inexistente, que explotaba en `venta.create` por la FK. Desde que
  // `crearVenta` resuelve `clienteId` y `usuarioId` contra el cliente
  // transaccional —el arreglo del hallazgo de las FKs entre tenants—, ese fallo
  // se mudó a ANTES del contador y el test se volvía trivial. Los candidatos que
  // quedaban se descartan solos: la FK del artículo también se valida antes, y
  // el correlativo lo asigna el motor, así que una colisión de `numero` sólo se
  // fabrica adivinando el próximo número desde el test, o sea acoplándolo a los
  // internos de `proximoNumero`.
  //
  // El desborde no se puede mudar temprano, y no por descuido: el UPDATE del
  // stock es RELATIVO (`stock = stock + delta`) a propósito —es lo que hace que
  // dos ventas simultáneas no se pisen—, así que el valor resultante sólo se
  // conoce adentro de la transacción y con el lock ya tomado. Validarlo antes
  // sería releer el stock afuera, que es exactamente la carrera que el UPDATE
  // relativo existe para evitar. Y es además la ÚLTIMA sentencia de la
  // transacción: cuando falla ya están escritos el contador, la venta, su ítem,
  // su pago y el movimiento de stock. Es el rollback más exigente que el motor
  // admite.
  it('un fallo después de incrementar el contador también revierte todo', async () => {
    // Al borde de lo que entra en Decimal(12,3): un descuento de 1000 más lo
    // lleva a diez dígitos enteros y Postgres lo rechaza con 22003.
    await owner.query(`UPDATE articulos SET stock = -999999999 WHERE id = $1`, [desbordable])
    const numeroAntes = await enTransaccionDeTenant(tenantId, async (tx) =>
      (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })).proximoNumeroVenta,
    )

    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: desbordable, cantidad: d('1000') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000000'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'FUERA_DE_RANGO' })

    const numeroDespues = await enTransaccionDeTenant(tenantId, async (tx) =>
      (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })).proximoNumeroVenta,
    )
    expect(numeroDespues).toBe(numeroAntes)

    // Y tampoco quedó nada de lo que sí se había escrito antes del desborde.
    const { movs, items } = await enTransaccionDeTenant(tenantId, async (tx) => ({
      movs: await tx.movimientoStock.findMany({ where: { articuloId: desbordable } }),
      items: await tx.ventaItem.findMany({ where: { articuloId: desbordable } }),
    }))
    expect(movs).toHaveLength(0)
    expect(items).toHaveLength(0)
    expect(await stockDe(desbordable)).toBe('-999999999')
  })

  // Las FKs de Postgres NO alcanzan para esto: sus triggers corren como dueño de
  // la tabla referenciada, y el dueño está exento de RLS mientras no haya FORCE
  // ROW LEVEL SECURITY. O sea que la fila entraba, y el que lo pagaba era el
  // OTRO negocio: a partir de ahí no podía borrar a su propio cliente, porque el
  // onDelete Restrict se lo impedía nombrando una fila que RLS le esconde.
  it('rechaza un clienteId de otro tenant, y acepta el propio', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        clienteId: clienteAjeno,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'CLIENTE_INEXISTENTE' })

    // La otra mitad: si el chequeo rechazara TODO clienteId, el assert de arriba
    // pasaría igual y no probaría nada sobre tenants.
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      clienteId: clientePropio,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), cotizacion: d('1') }],
    })
    const venta = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.venta.findUniqueOrThrow({ where: { id } }),
    )
    expect(venta.clienteId).toBe(clientePropio)

    // Y la consecuencia que se medía en el review: el otro tenant sigue pudiendo
    // borrar a su cliente, porque ninguna venta ajena quedó apuntándole.
    await expect(
      owner.query('DELETE FROM clientes WHERE id = $1', [clienteAjeno]),
    ).resolves.toBeDefined()
  })

  it('rechaza un usuarioId de otro tenant', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId: usuarioAjeno,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'USUARIO_INEXISTENTE' })
  })

  // El caso exacto que se midió: `1.0005` a $1000 validaba contra un pago de
  // 1000,50 y la fila guardada terminaba diciendo `1.001 × 1000 = 1001`. La
  // venta no explicaba su propio total y el motor reportaba éxito. Se rechaza en
  // vez de recortar: ver el porqué en `excedeEscala`, en lib/ventas/totales.ts.
  it('rechaza una cantidad con más decimales de los que la columna guarda', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('1.0005') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000.50'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'ESCALA_EXCEDIDA' })
  })

  // La otra mitad, y no es redundante: si el chequeo mirara los decimales
  // ESCRITOS en vez de los significativos, `1.000` —tres ceros de cola, que es
  // como sale de un input de moneda— se rechazaría sin motivo.
  it('acepta la escala exacta de la columna, ceros de cola incluidos', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1.000') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000.00'), cotizacion: d('1.0000') }],
    })
    expect(id).toBeTruthy()
  })

  it('rechaza un monto con más de dos decimales', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000.005'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'ESCALA_EXCEDIDA' })
  })

  it('rechaza una cotización con más de cuatro decimales', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'USD', monto: d('1'), cotizacion: d('1000.00005') }],
      }),
    ).rejects.toMatchObject({ codigo: 'ESCALA_EXCEDIDA' })
  })

  // Cierra contra el total y aun así es mentira: la caja va a pedir 900 mil
  // pesos en efectivo que nunca entraron. Una devolución es una venta anulada,
  // no un pago en negativo.
  it('rechaza un pago negativo aunque la suma cierre', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [
          { medio: 'EFECTIVO', moneda: 'ARS', monto: d('900000'), cotizacion: d('1') },
          { medio: 'TARJETA_DEBITO', moneda: 'ARS', monto: d('-899000'), cotizacion: d('1') },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'MONTO_INVALIDO' })
  })

  // Sin cotización no se puede reconstruir a qué valor se tomó el dólar, que es
  // exactamente para lo que el campo existe.
  it('rechaza una cotización en cero', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'USD', monto: d('1'), cotizacion: d('0') }],
      }),
    ).rejects.toMatchObject({ codigo: 'COTIZACION_INVALIDA' })
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
  // Ahora que `ajustarStock` existe (Task 5), el test ejercita las DOS vías de
  // movimiento antes de reconciliar: un ingreso de 40 y una venta de 7.5. Si
  // sólo probara una de las dos, no distinguiría un bug que afecte a la otra.
  it('el stock cierra contra la suma de sus movimientos', async () => {
    await ajustarStock({
      tenantId,
      articuloId: recon,
      delta: d('40'),
      motivo: 'INGRESO',
      usuarioId,
      nota: 'stock inicial para la reconciliación',
    })
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
    expect(stock.toString()).toBe('32.5')
  })

  it('los números de venta son correlativos y sin huecos', async () => {
    const numeros = await enTransaccionDeTenant(tenantId, async (tx) =>
      (await tx.venta.findMany({ orderBy: { numero: 'asc' } })).map((v) => v.numero),
    )
    // Sin esta línea el test pasa con CERO ventas: `[]` es igual a `[]`. Es la
    // misma trampa que test/rls-cobertura.test.ts ya documenta — una aserción
    // que se cumple por vacío no prueba nada, y encima tapa el caso en que las
    // ventas dejaron de escribirse.
    expect(numeros.length, 'no hay ventas; los tests de arriba no escribieron nada').toBeGreaterThan(0)
    expect(numeros).toEqual(numeros.map((_, i) => i + 1))
  })
})

describe('anularVenta', () => {
  it('devuelve el stock y deja la venta legible', async () => {
    await owner.query(`UPDATE articulos SET stock = 50 WHERE id = $1`, [remera])
    const antes = new Prisma.Decimal(await stockDe(remera))

    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('3') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('3000'), cotizacion: d('1') }],
    })
    expect(new Prisma.Decimal(await stockDe(remera)).toString()).toBe(
      antes.minus(3).toString(),
    )

    await anularVenta({ tenantId, ventaId: id, usuarioId })

    expect(new Prisma.Decimal(await stockDe(remera)).toString()).toBe(antes.toString())

    const venta = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.venta.findUniqueOrThrow({ where: { id }, include: { items: true, pagos: true } }),
    )
    // La venta NO se borra: sus ítems y su total quedan intactos, porque el día
    // que exista ARCA ésta va a ser el comprobante que necesita su nota de
    // crédito.
    expect(venta.anuladaEn).not.toBeNull()
    expect(venta.anuladaPorId).toBe(usuarioId)
    expect(venta.total.toString()).toBe('3000')
    expect(venta.items).toHaveLength(1)
    expect(venta.pagos).toHaveLength(1)

    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { ventaId: id }, orderBy: { creadoEn: 'asc' } }),
    )
    expect(movs.map((m) => m.motivo)).toEqual(['VENTA', 'ANULACION_VENTA'])
    expect(movs[1].delta.toString()).toBe('3')
  })

  // El reintento de un click es más probable que la mala intención.
  it('anular dos veces no duplica la devolución', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), cotizacion: d('1') }],
    })
    await anularVenta({ tenantId, ventaId: id, usuarioId })
    const stockTrasPrimera = await stockDe(remera)

    await anularVenta({ tenantId, ventaId: id, usuarioId })

    expect(await stockDe(remera)).toBe(stockTrasPrimera)
    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { ventaId: id, motivo: 'ANULACION_VENTA' } }),
    )
    expect(movs).toHaveLength(1)
  })

  // El de arriba llama en SECUENCIA: la primera transacción siempre comitea
  // antes de que arranque la segunda, así que nunca ejercita la ventana entre
  // leer y decidir — daba verde incluso con el guard que sí se pisaba. Éste
  // solapa las dos anulaciones, que es lo que hace un doble click en la UI.
  // Con un `findUnique` + `if (anuladaEn !== null)` las dos leen `null` antes de
  // que cualquiera escriba, las dos compensan, y el stock queda acreditado dos
  // veces por el delta completo.
  it('dos anulaciones simultáneas compensan una sola vez', async () => {
    const antes = new Prisma.Decimal(await stockDe(remera))

    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('5') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('5000'), cotizacion: d('1') }],
    })

    await Promise.all([
      anularVenta({ tenantId, ventaId: id, usuarioId }),
      anularVenta({ tenantId, ventaId: id, usuarioId }),
    ])

    // El valor exacto de antes de la venta, no "algo parecido": sobre-acreditar
    // es justamente el síntoma.
    expect(new Prisma.Decimal(await stockDe(remera)).toString()).toBe(antes.toString())
    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { ventaId: id, motivo: 'ANULACION_VENTA' } }),
    )
    expect(movs).toHaveLength(1)
  })

  it('una venta de servicios se anula sin mover stock', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('500'), cotizacion: d('1') }],
    })
    await anularVenta({ tenantId, ventaId: id, usuarioId })

    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { ventaId: id } }),
    )
    expect(movs).toHaveLength(0)
  })

  it('rechaza una venta que no existe', async () => {
    await expect(
      anularVenta({
        tenantId,
        ventaId: '00000000-0000-7000-8000-000000000000',
        usuarioId,
      }),
    ).rejects.toMatchObject({ codigo: 'VENTA_INEXISTENTE' })
  })

  it('rechaza un usuarioId de otro tenant sin tocar la venta', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), cotizacion: d('1') }],
    })

    await expect(
      anularVenta({ tenantId, ventaId: id, usuarioId: usuarioAjeno }),
    ).rejects.toMatchObject({ codigo: 'USUARIO_INEXISTENTE' })

    // El chequeo va ANTES del UPDATE justamente para esto: si fuera después, la
    // venta ya habría quedado anulada con la FK ajena escrita.
    const venta = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.venta.findUniqueOrThrow({ where: { id } }),
    )
    expect(venta.anuladaEn).toBeNull()
    expect(venta.anuladaPorId).toBeNull()
  })

  // La afirmación del comentario de `anularVenta` —que derivar de los
  // MOVIMIENTOS y no de los ítems hace que las dos mitades coincidan "aunque el
  // tipo del artículo haya cambiado"— no tenía cobertura. Acá se cumple la
  // condición: el artículo pasa a SERVICIO entre la venta y la anulación.
  // Recorrer los ítems daría cero movimientos compensatorios (ningún ítem sería
  // de un PRODUCTO) y el stock quedaría descontado para siempre; este test lo
  // vería como `8` en vez de `10`.
  it('compensa los movimientos y no los ítems: aunque el artículo pase a SERVICIO, devuelve el stock', async () => {
    const antes = new Prisma.Decimal(await stockDe(mutante))

    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: mutante, cantidad: d('2') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('200'), cotizacion: d('1') }],
    })
    expect(new Prisma.Decimal(await stockDe(mutante)).toString()).toBe(antes.minus(2).toString())

    await owner.query(`UPDATE articulos SET tipo = 'SERVICIO' WHERE id = $1`, [mutante])

    await anularVenta({ tenantId, ventaId: id, usuarioId })

    expect(new Prisma.Decimal(await stockDe(mutante)).toString()).toBe(antes.toString())
    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { ventaId: id, motivo: 'ANULACION_VENTA' } }),
    )
    expect(movs).toHaveLength(1)
    expect(movs[0].delta.toString()).toBe('2')
  })
})

describe('idempotencia del cobro', () => {
  it('la misma clave dos veces crea UNA venta y descuenta el stock UNA vez', async () => {
    const antes = new Prisma.Decimal(await stockDe(remera))
    const clave = `clave-${Date.now()}`
    const entrada = {
      tenantId,
      usuarioId,
      claveIdempotencia: clave,
      items: [{ articuloId: remera, cantidad: d('2') }],
      pagos: [{ medio: 'EFECTIVO' as const, moneda: 'ARS' as const, monto: d('2000'), cotizacion: d('1') }],
    }

    const primera = await crearVenta(entrada)
    // La MISMA llamada de verdad, no una simulación: es el doble click.
    const segunda = await crearVenta(entrada)

    expect(segunda.id, 'creó una venta nueva en vez de devolver la que existía').toBe(primera.id)
    expect(segunda.numero).toBe(primera.numero)

    // Lo que de verdad importa: el stock se movió una sola vez.
    expect(await stockDe(remera)).toBe(antes.minus(2).toString())

    const cuantas = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.venta.count({ where: { claveIdempotencia: clave } }),
    )
    expect(cuantas).toBe(1)
  })

  it('sin clave, dos llamadas iguales crean dos ventas: el motor no adivina', async () => {
    const entrada = {
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO' as const, moneda: 'ARS' as const, monto: d('1000'), cotizacion: d('1') }],
    }
    const a = await crearVenta(entrada)
    const b = await crearVenta(entrada)
    expect(b.id).not.toBe(a.id)
  })

  it('claves distintas son ventas distintas', async () => {
    const base = {
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO' as const, moneda: 'ARS' as const, monto: d('1000'), cotizacion: d('1') }],
    }
    const a = await crearVenta({ ...base, claveIdempotencia: `a-${Date.now()}` })
    const b = await crearVenta({ ...base, claveIdempotencia: `b-${Date.now()}` })
    expect(b.id).not.toBe(a.id)
  })
})

describe('un artículo desactivado no se puede vender', () => {
  it('se rechaza con su propio código, distinto de inexistente', async () => {
    const propio = await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, desactivado_en, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'OFF-1', 'Discontinuado', 'PRODUCTO', 500.00, 10, now(), now(), now())
       RETURNING id`,
      [tenantId],
    )
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: propio.rows[0].id, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('500'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_DESACTIVADO' })
  })

  it('y sigue distinguiéndose de uno que no existe', async () => {
    // Los dos códigos mandan a la persona a lugares distintos: uno a buscar de
    // nuevo, el otro a reactivarlo desde inventario. Si esta distinción se
    // pierde, el mensaje de la pantalla miente.
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: '00000000-0000-7000-8000-000000000000', cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('500'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
  })
})

describe('buscarArticulosVendibles', () => {
  it('encuentra por nombre y por código, sin distinguir mayúsculas', async () => {
    const porNombre = await buscarArticulosVendibles(tenantId, 'reme')
    expect(porNombre.map((a) => a.id)).toContain(remera)
    const porSku = await buscarArticulosVendibles(tenantId, 'rem-1')
    expect(porSku.map((a) => a.id)).toContain(remera)
  })

  it('no ofrece un artículo desactivado', async () => {
    const off = await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, desactivado_en, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'BUS-OFF', 'Buscable apagado', 'PRODUCTO', 100.00, 5, now(), now(), now())
       RETURNING id`,
      [tenantId],
    )
    const r = await buscarArticulosVendibles(tenantId, 'Buscable apagado')
    expect(r.map((a) => a.id), 'ofreció un artículo desactivado').not.toContain(off.rows[0].id)
  })

  it('no cruza tenants', async () => {
    await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'AJENO-1', 'Remera ajena', 'PRODUCTO', 100.00, 5, now(), now())`,
      [otroTenantId],
    )
    const r = await buscarArticulosVendibles(tenantId, 'Remera ajena')
    expect(r).toHaveLength(0)
  })

  it('devuelve la plata como string, no como Decimal', async () => {
    const [uno] = await buscarArticulosVendibles(tenantId, 'rem-1')
    expect(typeof uno.precio).toBe('string')
    expect(typeof uno.stock).toBe('string')
  })

  it('un texto vacío no devuelve el catálogo entero', async () => {
    // Sin este guard, el primer foco en el buscador traería todo.
    expect(await buscarArticulosVendibles(tenantId, '   ')).toHaveLength(0)
  })
})

describe('ultimaCotizacionUsd', () => {
  it('es null cuando el local nunca cobró en dólares', async () => {
    const virgen = await crearTenant(owner, `sin-usd-${Date.now()}`)
    expect(await ultimaCotizacionUsd(virgen)).toBeNull()
  })

  it('devuelve la del último pago en dólares y no la de otro tenant', async () => {
    // `remera` cuesta 1000, así que una unidad son $1000 de total. US$ 0,80 a
    // 1250 dan exactamente eso: los pagos TIENEN que cerrar contra el total o
    // el motor rechaza la venta, y el test estaría probando otra cosa.
    await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'USD', monto: d('0.8'), cotizacion: d('1250') }],
    })
    // Sin ceros de cola, no '1250.0000': el `Decimal` de Prisma normaliza al
    // convertir a string, tal como ya lo prueba "congela el precio" más
    // arriba con `precioUnitario` (Decimal(12,2), guarda 1000.00 y da '1000').
    // La suposición original de este test —que el toString conserva la
    // escala de la columna— no vale para el `Decimal` de Prisma.
    expect(await ultimaCotizacionUsd(tenantId)).toBe('1250')
    expect(await ultimaCotizacionUsd(otroTenantId)).toBeNull()
  })
})
