/**
 * Un mes y medio de movimiento sintético, para mirar `/dashboard` en dev:
 * `npm run dashboard:sembrar`.
 *
 * **Sólo dev.** Escribe ventas de mentira; correrlo contra una base con datos
 * de clientes ensucia la caja de alguien.
 *
 * POR QUÉ NO ALCANZA `sembrar-ventas-dev.mts`. Ese script existe para mirar
 * `/ventas`, y le basta con que HAYA pagos: crea sus trece ventas con la fecha
 * de hoy. El dashboard mide otra cosa —cómo viene el local— y ninguno de sus
 * paneles dice nada con trece ventas del mismo instante: la tendencia de
 * catorce días queda con una sola barra, los cuatro tiles no tienen período
 * anterior contra el cual comparar, así que ningún delta se dibuja, y "Cuándo
 * vende el local" no distingue un martes de un sábado.
 *
 * LAS VENTAS PASAN POR `crearVenta`, NO POR UN INSERT. Es lo que hace que el
 * costo quede congelado en cada `VentaItem` —el único escritor es el motor, al
 * cobrar— y por lo tanto lo único que hace que el tile de Margen bruto muestre
 * un número en vez de "ninguna venta del período tiene el costo cargado". De
 * paso mueve el stock y respeta los mismos invariantes que el mostrador, así
 * que los datos que quedan son datos que el producto podría haber producido.
 *
 * LA FECHA SE CORRIGE AL FINAL, Y CON EL ROL DUEÑO. `Venta.creadoEn` es
 * `@default(now())` y el motor no acepta una fecha por parámetro — con razón:
 * una venta se cobra cuando se cobra. Así que el reparto en el tiempo va en un
 * segundo paso, y arrastra a `Pago` y a `MovimientoStock` con la misma marca
 * para que el historial de un artículo no contradiga a su venta.
 *
 * Ese paso NO puede correr como la aplicación: `arandano_app` no tiene UPDATE
 * sobre `movimientos_stock`, y no es un permiso que falte sino la definición
 * de la tabla — es un libro append-only, y que la app no pueda reescribirlo es
 * justamente la garantía. Un fixture que fabrica dos meses de historia sí
 * necesita hacerlo, así que abre su propia conexión como `arandano_owner`
 * (MIGRATE_DATABASE_URL) y lo dice acá. Si algún día este script pudiera
 * hacerlo con el rol de la app, el que estaría mal sería el permiso.
 *
 * EL RITMO NO ES UNIFORME, y eso es la mitad del punto. Un local vende más los
 * viernes y los sábados y casi nada los domingos; con ventas repartidas parejo
 * el panel "Cuándo vende el local" muestra una meseta y no se puede juzgar si
 * la barra del pico se distingue de las demás, que es justamente lo que hay
 * que mirar a ojo.
 */
import { Prisma } from '@/generated/prisma/client'
import type { MedioPago, Moneda } from '@/generated/prisma/client'
import { crearVenta } from '@/lib/ventas/crear'
import { anularVenta } from '@/lib/ventas/anular'
import { crearPlan } from '@/lib/planes/administrar'
import { ingresarStock } from '@/lib/inventario/stock'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { prisma } from '@/lib/db'
import { Client } from 'pg'

const d = (v: string) => new Prisma.Decimal(v)
const COTIZACION = d('1485')

/** Cuántos días hacia atrás. Dos meses: el mes en curso más el anterior
 *  completo, que es lo que el chip "Este mes" necesita para tener un período
 *  anterior con el cual compararse. */
const DIAS = 62

const [tenantId, usuarioId] = process.argv.slice(2)
if (!tenantId || !usuarioId) {
  throw new Error('uso: sembrar-dashboard-dev.mts <tenantId> <usuarioId>')
}

const db = prismaParaTenant(tenantId)

const articulos = await db.articulo.findMany({
  where: { desactivadoEn: null },
  select: { id: true, sku: true, precio: true, moneda: true, tipo: true },
})
const porSku = (sku: string) => {
  const a = articulos.find((x) => x.sku === sku)
  if (!a) throw new Error(`falta el artículo ${sku} — corré antes catalogo:sembrar`)
  return a
}

// ── Planes de pago ────────────────────────────────────────────────────────
// El caso textual del feedback que abrió ese ciclo ("crédito en 1 pago 10 %,
// crédito en cuotas 40 %") más el descuento por pago contado, que este
// producto trata como caso de primera clase y es el único plan con signo
// negativo. Sin ninguno cargado, `Venta.recargo` es cero en todas las filas y
// el desglose "Vendido / Cobrado" de los tiles no se puede ver funcionando.
const planes: { id: string; medio: MedioPago; cuotas: number }[] = await (async () => {
  const yaHay = await db.planDePago.count()
  if (yaHay > 0) {
    console.log(`planes: ya había ${yaHay}, no se tocan`)
    return db.planDePago.findMany({ select: { id: true, medio: true, cuotas: true } })
  }
  const recetas = [
    { nombre: 'Contado', medio: 'EFECTIVO' as MedioPago, cuotas: 1, recargoPorcentaje: d('-10'), orden: 1 },
    { nombre: 'Crédito 1 pago', medio: 'TARJETA_CREDITO' as MedioPago, cuotas: 1, recargoPorcentaje: d('10'), orden: 2 },
    { nombre: 'Crédito 12 cuotas', medio: 'TARJETA_CREDITO' as MedioPago, cuotas: 12, recargoPorcentaje: d('40'), orden: 3 },
  ]
  for (const r of recetas) {
    await crearPlan({ tenantId, ...r })
    console.log(`plan: ${r.nombre} (${r.recargoPorcentaje}%)`)
  }
  return db.planDePago.findMany({ select: { id: true, medio: true, cuotas: true } })
})()
const planDe = (medio: MedioPago, cuotas: number) =>
  planes.find((p) => p.medio === medio && p.cuotas === cuotas)

// ── Stock ─────────────────────────────────────────────────────────────────
// Antes de vender, no después: `crearVenta` descuenta de verdad, y sesenta
// días de movimiento agotan un stock de cincuenta unidades a mitad de camino.
// El ingreso lleva su costo, que es lo que después se congela en cada venta.
const REPOSICION: [string, string, string][] = [
  ['A-0001', '400', '2600'], ['A-0002', '300', '5100'], ['A-0003', '250', '14000'],
  ['A-0004', '60', '640000'], ['A-0005', '80', '78000'], ['A-0007', '500', '420'],
  ['A-0008', '200', '8700'], ['A-0009', '40', null as unknown as string],
]
for (const [sku, cantidad, costo] of REPOSICION) {
  await ingresarStock({
    tenantId,
    articuloId: porSku(sku).id,
    cantidad: d(cantidad),
    usuarioId,
    // El iPhone está cargado en dólares y `costoUnitario` se guarda en pesos:
    // compararlos exigiría inventar una cotización, así que va sin costo — el
    // mismo criterio que ya toma el tile "Último costo" de /inventario/[id].
    costoUnitario: costo ? d(costo) : null,
    nota: 'Reposición para el seed del dashboard',
  })
}
console.log(`stock repuesto en ${REPOSICION.length} artículos`)

// ── El ritmo de la semana ─────────────────────────────────────────────────
/** Ventas por día según el día de la semana (0 = domingo). Un local de calle:
 *  el sábado es el pico, el domingo casi no abre. */
const VENTAS_POR_DIA = [1, 4, 5, 5, 6, 8, 9]

/** Un entero en [0, n) con una secuencia determinística: dos corridas del seed
 *  producen la misma base, así que una diferencia al mirar la pantalla es un
 *  cambio del código y no del azar. */
let semilla = 20260903
const azar = () => {
  semilla = (semilla * 1664525 + 1013904223) % 4294967296
  return semilla / 4294967296
}
const entre = (n: number) => Math.floor(azar() * n)

type Receta = {
  items: [string, string][]
  pagos: { medio: MedioPago; moneda: Moneda; base: string; cubre?: Moneda; plan?: 1 | 12 }[]
}

/** El carrito típico de un local de celulares: mucho accesorio barato, algún
 *  repuesto, y de vez en cuando un teléfono que se lleva el día. */
function recetaAlAzar(): Receta {
  const tirada = entre(100)

  if (tirada < 6) {
    // El teléfono en dólares. Minoría, como en un local real — y es lo que hace
    // aparecer el selector $ / US$ y la segunda línea del tile de marca.
    const enDolares = azar() < 0.6
    return enDolares
      ? { items: [['A-0009', '1']], pagos: [{ medio: 'EFECTIVO', moneda: 'USD', base: '300', cubre: 'USD' }] }
      : {
          // Pagado en PESOS cubriendo el total en dólares: el cruce que el
          // ciclo del precio en USD existe para soportar.
          items: [['A-0009', '1']],
          pagos: [{ medio: 'TRANSFERENCIA', moneda: 'ARS', base: '300', cubre: 'USD' }],
        }
  }

  if (tirada < 14) {
    // El Samsung, en cuotas: el caso donde el recargo del plan se ve de verdad.
    return {
      items: [['A-0004', '1']],
      pagos: [{ medio: 'TARJETA_CREDITO', moneda: 'ARS', base: '899999', plan: 12 }],
    }
  }

  if (tirada < 26) {
    // Servicio técnico: mano de obra, a veces con el repuesto.
    const conRepuesto = azar() < 0.5
    const items: [string, string][] = conRepuesto ? [['A-0006', '1'], ['A-0005', '1']] : [['A-0006', '1']]
    const total = conRepuesto ? '297500' : '185000'
    return { items, pagos: [{ medio: azar() < 0.5 ? 'EFECTIVO' : 'TRANSFERENCIA', moneda: 'ARS', base: total }] }
  }

  // Accesorios: uno o dos, el grueso del mostrador.
  const catalogo: [string, string][] = [
    ['A-0001', '4500'], ['A-0002', '8900'], ['A-0003', '23750'],
    ['A-0007', '990'], ['A-0008', '15900'],
  ]
  const primero = catalogo[entre(catalogo.length)]
  const dos = azar() < 0.35
  const segundo = dos ? catalogo[entre(catalogo.length)] : null
  const items: [string, string][] = segundo && segundo[0] !== primero[0]
    ? [[primero[0], '1'], [segundo[0], '1']]
    : [[primero[0], String(1 + entre(2))]]

  const total = items.reduce((acc, [sku, cant]) => {
    const precio = catalogo.find((c) => c[0] === sku)![1]
    return acc.add(d(precio).mul(cant))
  }, new Prisma.Decimal(0))

  const m = entre(100)
  const medio: MedioPago =
    m < 42 ? 'EFECTIVO' : m < 70 ? 'TRANSFERENCIA' : m < 88 ? 'TARJETA_DEBITO' : 'TARJETA_CREDITO'
  return {
    items,
    pagos: [{
      medio,
      moneda: 'ARS',
      base: total.toString(),
      // El contado con descuento y el crédito en un pago: los dos planes que
      // mueven el número sin ser el caso extremo de las 12 cuotas.
      plan: medio === 'EFECTIVO' && azar() < 0.25 ? 1 : medio === 'TARJETA_CREDITO' ? 1 : undefined,
    }],
  }
}

// ── Las ventas ────────────────────────────────────────────────────────────
const hoy = new Date()
let creadas = 0
let anuladas = 0
/** [ventaId, cuándo, si se anuló] — el reparto en el tiempo se aplica al
 *  final, de una, por lo que explica el docblock. */
const fechas: [string, Date, boolean][] = []

for (let atras = DIAS; atras >= 0; atras--) {
  const fecha = new Date(hoy)
  fecha.setDate(fecha.getDate() - atras)
  const cuantas = VENTAS_POR_DIA[fecha.getDay()] + entre(3)

  for (let i = 0; i < cuantas; i++) {
    const receta = recetaAlAzar()
    let ventaId: string
    try {
      const creada = await crearVenta({
        tenantId,
        usuarioId,
        items: receta.items.map(([sku, cantidad]) => ({ articuloId: porSku(sku).id, cantidad: d(cantidad) })),
        pagos: receta.pagos.map((p) => {
          const plan = p.plan ? planDe(p.medio, p.plan) : undefined
          return {
            medio: p.medio,
            moneda: p.moneda,
            cubre: p.cubre,
            base: d(p.base),
            // Cotización real sólo cuando el pago CRUZA monedas; 1 cuando no,
            // que es lo que guarda el mostrador (`cotizacionParaElCruce`).
            cotizacion: p.cubre === p.moneda || (!p.cubre && p.moneda === 'ARS') ? d('1') : COTIZACION,
            planId: plan?.id,
          }
        }),
      })
      ventaId = creada.id
      creadas++
    } catch (e) {
      console.error(`  venta salteada: ${(e as Error).message}`)
      continue
    }

    // La hora: entre las 9 y las 20, que es el horario de un comercio. Sin
    // esto todas caerían en el mismo minuto y el panel por hora sería una
    // única columna.
    const marca = new Date(fecha)
    marca.setHours(9 + entre(11), entre(60), entre(60), 0)

    // Una de cada treinta se anula: el tile de Anuladas necesita algo que
    // contar, y es la regla que más veces se verificó en este ciclo (una venta
    // anulada no es plata que entró).
    let anulada = false
    if (entre(30) === 0) {
      // Por el motor y no con un UPDATE a `anuladaEn`: `anularVenta` devuelve
      // el stock con sus movimientos de reversa, así que el historial de
      // /inventario/[id] sigue cerrando contra `Articulo.stock`. Un seed que
      // marca la columna a mano deja esa cuenta rota y el próximo que mire esa
      // pantalla persigue un fantasma.
      await anularVenta({ tenantId, ventaId, usuarioId })
      anulada = true
      anuladas++
    }
    fechas.push([ventaId, marca, anulada])
  }
}

await prisma.$disconnect()

// ── El reparto en el tiempo ───────────────────────────────────────────────
const urlDuenio = process.env.MIGRATE_DATABASE_URL
if (!urlDuenio) throw new Error('falta MIGRATE_DATABASE_URL: el reparto de fechas corre como arandano_owner')
const owner = new Client({ connectionString: urlDuenio })
await owner.connect()
const ids = fechas.map((f) => f[0])
const marcas = fechas.map((f) => f[1])
// Una sentencia por tabla y no una por venta: son tres UPDATE contra un JOIN
// con la lista, no ~1200 idas y vueltas.
for (const tabla of ['ventas', 'pagos', 'movimientos_stock']) {
  const columna = tabla === 'ventas' ? 'id' : 'venta_id'
  await owner.query(
    `UPDATE ${tabla} t SET creado_en = f.marca
       FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::timestamptz[]) AS marca) f
      WHERE t.${columna} = f.id`,
    [ids, marcas],
  )
}
// La anulación lleva la misma marca que la venta: una venta anulada "tres
// semanas después" en un seed no significa nada y ensucia el tile de Anuladas.
await owner.query(
  `UPDATE ventas t SET anulada_en = f.marca
     FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::timestamptz[]) AS marca) f
    WHERE t.id = f.id AND t.anulada_en IS NOT NULL`,
  [ids, marcas],
)
await owner.end()

console.log(`\n${creadas} ventas en ${DIAS + 1} días (${anuladas} anuladas)`)
