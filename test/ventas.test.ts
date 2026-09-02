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
let ingresarStock: typeof import('@/lib/inventario/stock').ingresarStock
let buscarArticulosVendibles: typeof import('@/lib/ventas/buscar').buscarArticulosVendibles
let prismaParaTenant: typeof import('@/lib/tenant/prisma').prismaParaTenant
// Sólo para el test de `buscarArticulosVendibles` que necesita un artículo en
// dólares: el resto del archivo sigue dando de alta artículos con SQL crudo
// contra `owner` (ver el `beforeAll`), y así se queda.
let crearArticulo: typeof import('@/lib/inventario/articulos').crearArticulo
let crearPlan: typeof import('@/lib/planes/administrar').crearPlan
let desactivarPlan: typeof import('@/lib/planes/administrar').desactivarPlan
// De app/(app)/ventas/page.tsx, no de lib/: es la regla de negocio que arma
// el tile "Total del período" de esa pantalla, y este archivo es donde vive
// el arnés de base efímera que la puede ejercitar de verdad — page.test.tsx
// (colocado con la pantalla) sólo prueba funciones que no tocan la base.
let totalDelPeriodo: typeof import('@/app/(app)/ventas/page').totalDelPeriodo
let pagosDelPeriodo: typeof import('@/app/(app)/ventas/page').pagosDelPeriodo

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
  ;({ ajustarStock, ingresarStock } = await import('@/lib/inventario/stock'))
  ;({ buscarArticulosVendibles } = await import('@/lib/ventas/buscar'))
  ;({ prismaParaTenant } = await import('@/lib/tenant/prisma'))
  ;({ crearArticulo } = await import('@/lib/inventario/articulos'))
  ;({ crearPlan, desactivarPlan } = await import('@/lib/planes/administrar'))
  ;({ totalDelPeriodo, pagosDelPeriodo } = await import('@/app/(app)/ventas/page'))

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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('2000'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500'), cotizacion: d('1') }],
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
        { medio: 'EFECTIVO', moneda: 'ARS', base: d('500'), cotizacion: d('1') },
        { medio: 'EFECTIVO', moneda: 'USD', base: d('0.5'), cotizacion: d('1000') },
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
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('999'), cotizacion: d('1') }],
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
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000000'), cotizacion: d('1') }],
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
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'CLIENTE_INEXISTENTE' })

    // La otra mitad: si el chequeo rechazara TODO clienteId, el assert de arriba
    // pasaría igual y no probaría nada sobre tenants.
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      clienteId: clientePropio,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
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
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
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
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000.50'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000.00'), cotizacion: d('1.0000') }],
    })
    expect(id).toBeTruthy()
  })

  it('rechaza un monto con más de dos decimales', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000.005'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'ESCALA_EXCEDIDA' })
  })

  it('rechaza una cotización con más de cuatro decimales', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'USD', base: d('1'), cotizacion: d('1000.00005') }],
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
          { medio: 'EFECTIVO', moneda: 'ARS', base: d('900000'), cotizacion: d('1') },
          { medio: 'TARJETA_DEBITO', moneda: 'ARS', base: d('-899000'), cotizacion: d('1') },
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
        pagos: [{ medio: 'EFECTIVO', moneda: 'USD', base: d('1'), cotizacion: d('0') }],
      }),
    ).rejects.toMatchObject({ codigo: 'COTIZACION_INVALIDA' })
  })

  it('rechaza un artículo que no existe', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: '00000000-0000-7000-8000-000000000000', cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000000'), cotizacion: d('1') }],
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
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('750'), cotizacion: d('1') }],
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

describe('cobrar con un plan de pago', () => {
  /** La venta con sus pagos, leída desde la transacción del tenant. */
  async function ventaConPagos(id: string) {
    return enTransaccionDeTenant(tenantId, async (tx) =>
      tx.venta.findUniqueOrThrow({ where: { id }, include: { pagos: true } }),
    )
  }

  // Diez remeras de 1000: 10.000 de mercadería, que es el total redondo con el
  // que se leen a ojo los porcentajes de todos los casos de abajo. Función y no
  // constante porque `remera` se resuelve recién en el `beforeAll`.
  const items = () => [{ articuloId: remera, cantidad: d('10') }]

  it('un plan del 25 % cobra 25 % más, y la venta guarda el recargo', async () => {
    const plan = await crearPlan({
      tenantId,
      nombre: 'Crédito 3 cuotas',
      medio: 'TARJETA_CREDITO',
      cuotas: 3,
      recargoPorcentaje: d('25'),
    })
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: items(),
      pagos: [
        {
          medio: 'TARJETA_CREDITO',
          moneda: 'ARS',
          base: d('10000'),
          cotizacion: d('1'),
          planId: plan.id,
        },
      ],
    })

    const venta = await ventaConPagos(id)
    // La mercadería NO cambia: el margen del artículo se sigue midiendo contra
    // el precio de lista.
    expect(venta.total.toString()).toBe('10000')
    expect(venta.recargo.toString()).toBe('2500')
    expect(venta.pagos[0].monto.toString()).toBe('12500')
    expect(venta.pagos[0].recargo.toString()).toBe('2500')
    expect(venta.pagos[0].planDePagoId).toBe(plan.id)
  })

  it('un plan con porcentaje negativo descuenta', async () => {
    const plan = await crearPlan({
      tenantId,
      nombre: 'Contado',
      medio: 'EFECTIVO',
      cuotas: 1,
      recargoPorcentaje: d('-10'),
    })
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: items(),
      pagos: [
        { medio: 'EFECTIVO', moneda: 'ARS', base: d('10000'), cotizacion: d('1'), planId: plan.id },
      ],
    })

    const venta = await ventaConPagos(id)
    expect(venta.recargo.toString()).toBe('-1000')
    expect(venta.pagos[0].monto.toString()).toBe('9000')
  })

  it('pago partido: el recargo cae SÓLO sobre la parte financiada', async () => {
    const plan = await crearPlan({
      tenantId,
      nombre: 'Crédito 6 cuotas',
      medio: 'TARJETA_CREDITO',
      cuotas: 6,
      recargoPorcentaje: d('40'),
    })
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: items(),
      pagos: [
        { medio: 'EFECTIVO', moneda: 'ARS', base: d('4000'), cotizacion: d('1') },
        {
          medio: 'TARJETA_CREDITO',
          moneda: 'ARS',
          base: d('6000'),
          cotizacion: d('1'),
          planId: plan.id,
        },
      ],
    })

    const venta = await ventaConPagos(id)
    expect(venta.total.toString()).toBe('10000')
    // 40 % de 6.000, no de 10.000: los 4.000 en efectivo no pagan el costo de
    // la tarjeta. Si el recargo se aplicara a la venta entera, acá diría 4000.
    expect(venta.recargo.toString()).toBe('2400')
    const enEfectivo = venta.pagos.find((p) => p.medio === 'EFECTIVO')!
    expect(enEfectivo.monto.toString()).toBe('4000')
    expect(enEfectivo.recargo.toString()).toBe('0')
    const conTarjeta = venta.pagos.find((p) => p.medio === 'TARJETA_CREDITO')!
    expect(conTarjeta.monto.toString()).toBe('8400')
    expect(conTarjeta.recargo.toString()).toBe('2400')
  })

  it('sin plan, todo sigue exactamente como antes', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: items(),
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('10000'), cotizacion: d('1') }],
    })

    const venta = await ventaConPagos(id)
    expect(venta.recargo.toString()).toBe('0')
    expect(venta.pagos[0].monto.toString()).toBe('10000')
    expect(venta.pagos[0].recargo.toString()).toBe('0')
    expect(venta.pagos[0].planDePagoId).toBeNull()
  })

  it('rechaza un plan que no existe', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: items(),
        pagos: [
          {
            medio: 'TARJETA_CREDITO',
            moneda: 'ARS',
            base: d('10000'),
            cotizacion: d('1'),
            planId: '00000000-0000-7000-8000-000000000000',
          },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_INEXISTENTE' })
  })

  // El MENSAJE y no sólo el código: `traducir` (app/(app)/vender/acciones.ts)
  // muestra `e.message` tal cual en el cartel del mostrador, así que este texto
  // es copy de producto y no un detalle de log. Llevaba el UUID del plan
  // adentro, que no le dice nada a quien está cobrando ni le indica qué hacer.
  it('el mensaje que ve el mostrador no lleva el id adentro, y dice qué hacer', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: items(),
        pagos: [
          {
            medio: 'TARJETA_CREDITO',
            moneda: 'ARS',
            base: d('10000'),
            cotizacion: d('1'),
            planId: '00000000-0000-7000-8000-000000000000',
          },
        ],
      }),
    ).rejects.toMatchObject({
      codigo: 'PLAN_INEXISTENTE',
      message: 'Ese plan de pago ya no está disponible. Recargá la pantalla y elegí otro.',
    })
  })

  it('rechaza un plan desactivado', async () => {
    const plan = await crearPlan({
      tenantId,
      nombre: 'Viejo',
      medio: 'TARJETA_CREDITO',
      cuotas: 3,
      recargoPorcentaje: d('20'),
    })
    await desactivarPlan({ tenantId, id: plan.id })

    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: items(),
        pagos: [
          {
            medio: 'TARJETA_CREDITO',
            moneda: 'ARS',
            base: d('10000'),
            cotizacion: d('1'),
            planId: plan.id,
          },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_INEXISTENTE' })
  })

  it('rechaza un plan de OTRO tenant', async () => {
    const ajeno = await crearPlan({
      tenantId: otroTenantId,
      nombre: 'Ajeno',
      medio: 'TARJETA_CREDITO',
      cuotas: 3,
      recargoPorcentaje: d('20'),
    })

    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: items(),
        pagos: [
          {
            medio: 'TARJETA_CREDITO',
            moneda: 'ARS',
            base: d('10000'),
            cotizacion: d('1'),
            planId: ajeno.id,
          },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_INEXISTENTE' })
  })

  it('rechaza un plan de crédito en un pago en efectivo', async () => {
    const plan = await crearPlan({
      tenantId,
      nombre: 'Crédito 12 cuotas',
      medio: 'TARJETA_CREDITO',
      cuotas: 12,
      recargoPorcentaje: d('60'),
    })

    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: items(),
        pagos: [
          { medio: 'EFECTIVO', moneda: 'ARS', base: d('10000'), cotizacion: d('1'), planId: plan.id },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_NO_CORRESPONDE' })
  })

  // La otra mitad del mismo guard, y la que NO se veía mirando la moneda —
  // párrafo escrito en pasado a propósito, porque describe cómo era ANTES de
  // Task 3 y hoy ya no es cierto: el invariante medía `base × cotizacion`
  // mientras el recargo se calculaba sobre `base` a secas, así que las dos
  // mitades sólo hablaban del mismo número con la cotización en 1, y un pago en
  // pesos "a cotización 2" con plan sub-cobraba el recargo. La pantalla nunca
  // lo mandaba —en ARS ni dibujaba el campo—, un POST armado a mano sí.
  // Task 3 (2026-08-29) le sacó esa mitad a la guarda: antes rechazaba
  // moneda ≠ ARS O cotización ≠ 1, ahora sólo la moneda (ver el comentario de
  // `PLAN_EN_DOLARES` en crear.ts). Un pago ARS que cubre el total en ARS
  // ignora la cotización —no hay ningún cruce de moneda que multiplicar—, así
  // que una cotización rara ya no es un caso especial: el pago simplemente
  // aporta su `base` tal cual, no cierra contra el total, y el invariante
  // general (`PAGOS_NO_CIERRAN`) es quien lo frena.
  it('un plan en un pago en pesos ignora la cotización: si no cierra, no cierra por el invariante general', async () => {
    const plan = await crearPlan({
      tenantId,
      nombre: 'Contado con cotización rara',
      medio: 'EFECTIVO',
      cuotas: 1,
      recargoPorcentaje: d('-10'),
    })

    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: items(),
        pagos: [
          { medio: 'EFECTIVO', moneda: 'ARS', base: d('5000'), cotizacion: d('2'), planId: plan.id },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'PAGOS_NO_CIERRAN' })
  })

  it('rechaza un plan en un pago en dólares', async () => {
    const plan = await crearPlan({
      tenantId,
      nombre: 'Contado dólar',
      medio: 'EFECTIVO',
      cuotas: 1,
      recargoPorcentaje: d('-10'),
    })

    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: items(),
        pagos: [
          { medio: 'EFECTIVO', moneda: 'USD', base: d('10'), cotizacion: d('1000'), planId: plan.id },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_EN_DOLARES' })
  })

  // Task 8 (las ventas muestran el recargo): `app/(app)/ventas/[id]/page.tsx`
  // pide el plan de cada pago SIN filtrar por `desactivadoEn` — la FK
  // `Pago.planDePagoId` es `Restrict` y la baja es lógica (Task 1), así que la
  // fila sigue estando. Este test ejercita el mecanismo de verdad, con la
  // MISMA forma de `select` que usa esa pantalla: una venta de marzo tiene
  // que seguir diciendo con qué plan se cobró, aunque el local ya haya dado
  // de baja ese plan para hoy.
  it('un plan dado de baja sigue apareciendo en el detalle de la venta que lo usó', async () => {
    const plan = await crearPlan({
      tenantId,
      nombre: 'Crédito 18 cuotas',
      medio: 'TARJETA_CREDITO',
      cuotas: 18,
      recargoPorcentaje: d('60'),
    })
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: items(),
      pagos: [
        {
          medio: 'TARJETA_CREDITO',
          moneda: 'ARS',
          base: d('10000'),
          cotizacion: d('1'),
          planId: plan.id,
        },
      ],
    })

    await desactivarPlan({ tenantId, id: plan.id })

    const venta = await prismaParaTenant(tenantId).venta.findUniqueOrThrow({
      where: { id },
      select: { pagos: { select: { plan: { select: { nombre: true, cuotas: true } } } } },
    })
    expect(venta.pagos[0].plan).not.toBeNull()
    expect(venta.pagos[0].plan?.nombre).toBe('Crédito 18 cuotas')
    expect(venta.pagos[0].plan?.cuotas).toBe(18)
  })
})

describe('venta con artículos en dólares', () => {
  // Alta cruda como owner, igual que el `beforeAll` de arriba: `crearArticulo`
  // de lib/inventario/articulos.ts recibe `moneda` recién en la Task 6, y
  // usarla acá invertiría el orden de las tasks. `sku` se sortea para no
  // chocar con los fixtures fijos del `beforeAll` ni entre sí.
  let contador = 0
  async function crearArticulo(e: {
    nombre: string
    precio: Prisma.Decimal
    moneda: 'ARS' | 'USD'
  }): Promise<{ id: string }> {
    contador += 1
    const r = await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, moneda, stock, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, 'PRODUCTO', $4, $5, 1000, now(), now())
       RETURNING id`,
      [tenantId, `USD-${Date.now()}-${contador}`, e.nombre, e.precio.toString(), e.moneda],
    )
    return { id: r.rows[0].id }
  }

  /** La venta con sus ítems y pagos, leída desde la transacción del tenant. */
  async function leerVenta(id: string) {
    return enTransaccionDeTenant(tenantId, async (tx) =>
      tx.venta.findUniqueOrThrow({ where: { id }, include: { items: true, pagos: true } }),
    )
  }

  it('un carrito todo en dólares se cobra en dólares, sin ninguna cotización', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: iphone.id, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'USD', cubre: 'USD', base: d('300'), cotizacion: d('1') }],
    })
    const v = await leerVenta(id)
    expect(v.total.toString()).toBe('0')
    expect(v.totalUsd.toString()).toBe('300')
    expect(v.items[0].moneda).toBe('USD')
    expect(v.pagos[0].cubre).toBe('USD')
    expect(v.pagos[0].monto.toString()).toBe('300')
  })

  it('un carrito mixto lleva los dos totales y cada pago cubre el suyo', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    const funda = await crearArticulo({ nombre: 'Funda', precio: d('15000'), moneda: 'ARS' })
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [
        { articuloId: iphone.id, cantidad: d('1') },
        { articuloId: funda.id, cantidad: d('1') },
      ],
      pagos: [
        { medio: 'EFECTIVO', moneda: 'USD', cubre: 'USD', base: d('300'), cotizacion: d('1') },
        { medio: 'TARJETA_DEBITO', moneda: 'ARS', cubre: 'ARS', base: d('15000'), cotizacion: d('1') },
      ],
    })
    const v = await leerVenta(id)
    expect(v.total.toString()).toBe('15000')
    expect(v.totalUsd.toString()).toBe('300')
  })

  it('pagar el total en dólares CON PESOS: se tipea la cotización y se cobran los pesos', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: iphone.id, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', cubre: 'USD', base: d('300'), cotizacion: d('1485') }],
    })
    const v = await leerVenta(id)
    expect(v.totalUsd.toString()).toBe('300')
    expect(v.pagos[0].monto.toString()).toBe('445500')
    expect(v.pagos[0].moneda).toBe('ARS')
    expect(v.pagos[0].cubre).toBe('USD')
  })

  it('un plan de cuotas sobre el total en dólares cobra 623700 y aporta 300 exactos', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    const plan = await crearPlan({
      tenantId,
      nombre: '12 cuotas',
      medio: 'TARJETA_CREDITO',
      cuotas: 12,
      recargoPorcentaje: d('40'),
    })
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: iphone.id, cantidad: d('1') }],
      pagos: [{
        medio: 'TARJETA_CREDITO', moneda: 'ARS', cubre: 'USD',
        base: d('300'), cotizacion: d('1485'), planId: plan.id,
      }],
    })
    const v = await leerVenta(id)
    expect(v.totalUsd.toString()).toBe('300')
    expect(v.recargo.toString()).toBe('178200')
    expect(v.pagos[0].monto.toString()).toBe('623700')
    expect(v.pagos[0].recargo.toString()).toBe('178200')
  })

  it('rechaza la venta si cierra en pesos pero no en dólares', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    const funda = await crearArticulo({ nombre: 'Funda', precio: d('15000'), moneda: 'ARS' })
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [
          { articuloId: iphone.id, cantidad: d('1') },
          { articuloId: funda.id, cantidad: d('1') },
        ],
        pagos: [
          { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS', base: d('15000'), cotizacion: d('1') },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'PAGOS_NO_CIERRAN' })
  })

  it('sigue rechazando un plan sobre un pago ENTREGADO en dólares', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    // Nombre distinto del plan del test anterior: la unicidad es
    // `(tenantId, medio, nombre)` y los dos comparten medio y tenant.
    const plan = await crearPlan({
      tenantId,
      nombre: '12 cuotas (pago en dólares)',
      medio: 'TARJETA_CREDITO',
      cuotas: 12,
      recargoPorcentaje: d('40'),
    })
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: iphone.id, cantidad: d('1') }],
        pagos: [{
          medio: 'TARJETA_CREDITO', moneda: 'USD', cubre: 'USD',
          base: d('300'), cotizacion: d('1'), planId: plan.id,
        }],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_EN_DOLARES' })
  })

  it('una venta SIN nada en dólares produce exactamente lo de siempre', async () => {
    const funda = await crearArticulo({ nombre: 'Funda', precio: d('15000'), moneda: 'ARS' })
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: funda.id, cantidad: d('1') }],
      // Sin `cubre`: el default del tipo tiene que valer ARS.
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('15000'), cotizacion: d('1') }],
    })
    const v = await leerVenta(id)
    expect(v.total.toString()).toBe('15000')
    expect(v.totalUsd.toString()).toBe('0')
    expect(v.recargo.toString()).toBe('0')
    expect(v.pagos[0].cubre).toBe('ARS')
    expect(v.items[0].moneda).toBe('ARS')
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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('3000'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('5000'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('200'), cotizacion: d('1') }],
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

describe('totalDelPeriodo (app/(app)/ventas/page.tsx)', () => {
  // I3 de la review final del rediseño de /ventas: sacar `anuladaEn: null`
  // del `aggregate` de esa pantalla dejaba 785/785 en verde — nada sostenía
  // la regla de que una venta anulada no cuenta como plata que entró. Este
  // test corre la función de verdad, contra la base, con un servicio (sin
  // stock que descontar) para no pisar los fixtures de stock de los demás
  // tests de este archivo.
  //
  // Contra el `antes`/`después` y no contra un número fijo: el tenant es
  // compartido por todo el archivo, así que otros tests ya sumaron ventas
  // propias antes de que éste corra — lo único estable es el DELTA que
  // produce este escenario puntual.
  it('no cuenta el total de una venta anulada del mismo período', async () => {
    const prisma = prismaParaTenant(tenantId)
    const donde = { creadoEn: { gte: new Date('2000-01-01T00:00:00Z'), lt: new Date('2999-01-01T00:00:00Z') } }

    const antes = await totalDelPeriodo(prisma, donde)
    const sumaAntes = new Prisma.Decimal(antes._sum.total ?? 0)

    await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500'), cotizacion: d('1') }],
    })
    // 1.4 unidades del servicio de $500 = $700: el total de una venta sale de
    // cantidad × precio del artículo (crearVenta lo congela ahí, no lo toma de
    // los pagos), así que no alcanza con pedir un pago de $700 sobre 1 unidad.
    const { id: idAAnular } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1.4') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('700'), cotizacion: d('1') }],
    })
    await anularVenta({ tenantId, ventaId: idAAnular, usuarioId })

    const despues = await totalDelPeriodo(prisma, donde)
    const sumaDespues = new Prisma.Decimal(despues._sum.total ?? 0)

    // Sólo entró el $500 cobrado: el $700 se anuló y no cuenta, aunque la
    // venta siga existiendo (crearVenta no la borra).
    expect(sumaDespues.minus(sumaAntes).toString()).toBe('500')
  })

  // Task 8: el tile "Total del período" de /ventas pasa a mostrar lo COBRADO
  // (`total + recargo`), no sólo la mercadería — así que `totalDelPeriodo()`
  // tiene que sumar el `recargo` del período, no sólo `total`. Mismo criterio
  // de antes/después que el test de arriba, ahora sobre `_sum.recargo`.
  it('también suma el recargo del período, para que el tile pueda mostrar lo cobrado', async () => {
    const prisma = prismaParaTenant(tenantId)
    const donde = { creadoEn: { gte: new Date('2000-01-01T00:00:00Z'), lt: new Date('2999-01-01T00:00:00Z') } }

    const antes = await totalDelPeriodo(prisma, donde)
    const sumaAntes = new Prisma.Decimal(antes._sum.recargo ?? 0)

    const plan = await crearPlan({
      tenantId,
      nombre: 'Crédito de totalDelPeriodo',
      medio: 'TARJETA_CREDITO',
      cuotas: 3,
      recargoPorcentaje: d('20'),
    })
    await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1') }],
      pagos: [
        {
          medio: 'TARJETA_CREDITO',
          moneda: 'ARS',
          base: d('500'),
          cotizacion: d('1'),
          planId: plan.id,
        },
      ],
    })

    const despues = await totalDelPeriodo(prisma, donde)
    const sumaDespues = new Prisma.Decimal(despues._sum.recargo ?? 0)

    // 20 % de $500 = $100.
    expect(sumaDespues.minus(sumaAntes).toString()).toBe('100')
  })

  // Task 11 (precio en dólares): el tile "Total del período" agrega una
  // segunda línea con lo que el período movió en dólares, así que
  // `totalDelPeriodo()` tiene que sumar `totalUsd` también — mismo criterio
  // de antes/después que los dos tests de arriba.
  it('también suma el totalUsd del período, para la segunda línea del tile', async () => {
    const prisma = prismaParaTenant(tenantId)
    const donde = { creadoEn: { gte: new Date('2000-01-01T00:00:00Z'), lt: new Date('2999-01-01T00:00:00Z') } }

    const antes = await totalDelPeriodo(prisma, donde)
    const sumaAntes = new Prisma.Decimal(antes._sum.totalUsd ?? 0)

    const iphone = await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, moneda, stock, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $2, 'iPhone de totalDelPeriodo', 'PRODUCTO', 300, 'USD', 10, now(), now())
       RETURNING id`,
      [tenantId, `USD-TDP-${Date.now()}`],
    )
    await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: iphone.rows[0].id, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'USD', cubre: 'USD', base: d('300'), cotizacion: d('1') }],
    })

    const despues = await totalDelPeriodo(prisma, donde)
    const sumaDespues = new Prisma.Decimal(despues._sum.totalUsd ?? 0)

    expect(sumaDespues.minus(sumaAntes).toString()).toBe('300')
  })
})

// El ciclo del cobrado por moneda: el tile "Total del período" muestra, además
// de la mercadería, la plata que entró en cada moneda. Sale de `Pago`, no de
// `Venta`, así que la regla "una venta anulada no es plata que entró" vuelve a
// necesitar su propio test contra la base — es exactamente el hallazgo I3, que
// mostró que borrar ese filtro dejaba 785 tests en verde.
//
// Mismo patrón de antes/después que los tres casos de arriba: el tenant es
// compartido por todo el archivo, así que lo único estable es el DELTA.
describe('pagosDelPeriodo (app/(app)/ventas/page.tsx)', () => {
  const donde = { creadoEn: { gte: new Date('2000-01-01T00:00:00Z'), lt: new Date('2999-01-01T00:00:00Z') } }

  const cobradoArs = (filas: { moneda: string; monto: Prisma.Decimal; _count: number }[]) =>
    filas
      .filter((f) => f.moneda === 'ARS')
      .reduce((acc, f) => acc.add(f.monto.mul(f._count)), new Prisma.Decimal(0))

  it('reparte los pagos a los dos lados de la anulación', async () => {
    const prisma = prismaParaTenant(tenantId)

    const cobradoAntes = cobradoArs(await pagosDelPeriodo(prisma, donde, false))
    const devueltoAntes = cobradoArs(await pagosDelPeriodo(prisma, donde, true))

    await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500'), cotizacion: d('1') }],
    })
    const { id: idAAnular } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1.4') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('700'), cotizacion: d('1') }],
    })
    await anularVenta({ tenantId, ventaId: idAAnular, usuarioId })

    const cobradoDespues = cobradoArs(await pagosDelPeriodo(prisma, donde, false))
    const devueltoDespues = cobradoArs(await pagosDelPeriodo(prisma, donde, true))

    // El $500 quedó del lado de lo cobrado; el $700 del lado de lo devuelto.
    // Si el filtro de anulación se cayera, el primero valdría 1200.
    expect(cobradoDespues.minus(cobradoAntes).toString()).toBe('500')
    expect(devueltoDespues.minus(devueltoAntes).toString()).toBe('700')
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
      pagos: [{ medio: 'EFECTIVO' as const, moneda: 'ARS' as const, base: d('2000'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO' as const, moneda: 'ARS' as const, base: d('1000'), cotizacion: d('1') }],
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
      pagos: [{ medio: 'EFECTIVO' as const, moneda: 'ARS' as const, base: d('1000'), cotizacion: d('1') }],
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
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500'), cotizacion: d('1') }],
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
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500'), cotizacion: d('1') }],
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

  it('el resultado dice en qué moneda está el precio', async () => {
    await crearArticulo({
      tenantId, usuarioId, nombre: 'iPhone', tipo: 'PRODUCTO', precio: d('300'), moneda: 'USD',
    })
    const [r] = await buscarArticulosVendibles(tenantId, 'iPhone')
    expect(r.moneda).toBe('USD')
  })
})

// El caso literal del feedback que abrió este ciclo, de punta a punta: un
// iPhone de lista US$ 300 cobrado con US$ 200 en billetes y el resto en pesos
// a 1485. Antes de este ciclo /ventas lo mostraba como "una venta de US$ 300";
// lo que tiene que decir es que se vendió US$ 300 y que entraron US$ 200 más
// $ 148.500.
//
// Va contra la base y no en cobrado.test.ts a propósito: lo que se prueba acá
// no es la aritmética —eso ya está— sino que `crearVenta` GUARDE los pagos de
// forma que las dos magnitudes salgan bien al leerlos.
describe('el caso del feedback: US$ 300 cobrados en dos monedas', () => {
  it('la venta se guarda con la mercadería en dólares y los pagos en su moneda', async () => {
    const { vendidoDeVenta, cobradoDePagos } = await import('@/lib/ventas/cobrado')

    const iphone = await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, moneda, stock, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $2, 'iPhone del feedback', 'PRODUCTO', 300, 'USD', 10, now(), now())
       RETURNING id`,
      [tenantId, `USD-FB-${Date.now()}`],
    )

    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: iphone.rows[0].id, cantidad: d('1') }],
      pagos: [
        // US$ 200 en billetes: la base va en dólares y cubre el total en dólares.
        { medio: 'EFECTIVO', moneda: 'USD', cubre: 'USD', base: d('200'), cotizacion: d('1485') },
        // Los US$ 100 restantes, pagados en PESOS a 1485: `base` sigue yendo en
        // dólares (es lo que cubre) y el motor calcula los $ 148.500.
        { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'USD', base: d('100'), cotizacion: d('1485') },
      ],
    })

    const venta = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.venta.findUniqueOrThrow({
        where: { id },
        select: {
          total: true, totalUsd: true, recargo: true,
          pagos: { select: { moneda: true, monto: true }, orderBy: { creadoEn: 'asc' } },
        },
      }),
    )

    // La mercadería no cambia: el iPhone es US$ 300 se pague como se pague.
    const vendido = vendidoDeVenta(venta)
    expect(vendido.ars.toString()).toBe('0')
    expect(vendido.usd.toString()).toBe('300')

    // Lo que entró al cajón, apilado por la moneda ENTREGADA.
    const cobrado = cobradoDePagos(venta.pagos)
    expect(cobrado.usd.toString()).toBe('200')
    expect(cobrado.ars.toString()).toBe('148500')

    // Y el defecto que este ciclo arregla, dicho como aserción: las dos
    // magnitudes NO son la misma, así que la pantalla tiene que mostrar las dos.
    expect(cobrado.usd.equals(vendido.usd)).toBe(false)
  })
})

describe('el costo se congela al cobrar', () => {
  it('toma el último INGRESO CON COSTO, no el ingreso más reciente', async () => {
    // Dos ingresos: el primero con costo, el segundo sin. El segundo es el más
    // reciente, y el que hay que ignorar — mismo criterio que el tile
    // "Último costo" de /inventario/[id].
    await ingresarStock({ tenantId, articuloId: remera, cantidad: d('10'),
      usuarioId, costoUnitario: d('600') })
    await ingresarStock({ tenantId, articuloId: remera, cantidad: d('5'),
      usuarioId, costoUnitario: null })

    const venta = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: remera, cantidad: d('2') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS',
        base: d('2000'), cotizacion: d('1') }],
    })

    const prisma = prismaParaTenant(tenantId)
    const items = await prisma.ventaItem.findMany({ where: { ventaId: venta.id } })
    expect(items[0].costoUnitario?.toString()).toBe('600')

    const guardada = await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })
    expect(guardada.costoArs.toString()).toBe('1200')        // 600 × 2
    expect(guardada.vendidoConCosto.toString()).toBe('2000') // 1000 × 2, a precio de lista
  })

  it('un artículo sin ningún ingreso con costo queda en NULL y no suma', async () => {
    const venta = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1') }], // $500, sin costo
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS',
        base: d('500'), cotizacion: d('1') }],
    })
    const prisma = prismaParaTenant(tenantId)
    const items = await prisma.ventaItem.findMany({ where: { ventaId: venta.id } })
    expect(items[0].costoUnitario).toBeNull()
    const guardada = await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })
    expect(guardada.costoArs.toString()).toBe('0')
    expect(guardada.vendidoConCosto.toString()).toBe('0')
  })

  // El costo se guarda en PESOS y el precio de este artículo está en dólares:
  // compararlos exigiría inventar una cotización. Misma decisión que
  // `textoDeMargen` en /inventario/[id].
  it('un ítem en dólares queda en NULL aunque el artículo tenga costo', async () => {
    const enUsd = await crearArticulo({
      tenantId, usuarioId, nombre: 'iPhone', tipo: 'PRODUCTO',
      precio: d('300'), moneda: 'USD', stockInicial: d('3'), costoUnitario: d('200000'),
    })
    const venta = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: enUsd.id, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'USD', cubre: 'USD',
        base: d('300'), cotizacion: d('1') }],
    })
    const prisma = prismaParaTenant(tenantId)
    const items = await prisma.ventaItem.findMany({ where: { ventaId: venta.id } })
    expect(items[0].costoUnitario).toBeNull()
    const guardada = await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })
    expect(guardada.costoArs.toString()).toBe('0')
    expect(guardada.vendidoConCosto.toString()).toBe('0')
  })

  // La mitad que importa del par de columnas: las dos suman EXACTAMENTE los
  // mismos ítems, así que el margen nunca divide por mercadería cuyo costo no
  // se conoce.
  it('con un ítem con costo y otro sin él, las dos columnas cubren sólo el primero', async () => {
    await ingresarStock({ tenantId, articuloId: remera, cantidad: d('10'),
      usuarioId, costoUnitario: d('600') })
    const venta = await crearVenta({
      tenantId, usuarioId,
      items: [
        { articuloId: remera, cantidad: d('1') },   // $1000, costo 600
        { articuloId: servicio, cantidad: d('1') }, // $500, sin costo
      ],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS',
        base: d('1500'), cotizacion: d('1') }],
    })
    const prisma = prismaParaTenant(tenantId)
    const g = await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })
    expect(g.costoArs.toString()).toBe('600')
    expect(g.vendidoConCosto.toString()).toBe('1000')
    expect(g.total.toString()).toBe('1500')
  })
})
