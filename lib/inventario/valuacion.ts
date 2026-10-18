import { Prisma } from '@/generated/prisma/client'
import { redondearDinero } from '@/lib/ventas/totales'
// `import type`, no de valor: mismo motivo que lib/dashboard/metricas.ts —
// `prismaParaTenant` acá sólo aparece dentro de un `ReturnType<typeof ...>`, y
// `costoTotalDeArticulo` es una función pura que un componente cliente va a
// querer importar directo. Con un import de valor, ese import alcanzaría
// lib/tenant/prisma.ts para test/limite-cliente-servidor.test.ts y se llevaría
// el bundle de cliente.
import type { prismaParaTenant } from '@/lib/tenant/prisma'

type Decimal = Prisma.Decimal

const CERO = new Prisma.Decimal(0)

/**
 * Cuánto costó la mercadería que queda de un artículo.
 *
 * `null` y CERO son dos respuestas distintas, y la diferencia es todo el
 * diseño de esta función:
 *
 * - `null` es **no se sabe**: ningún ingreso de este artículo cargó costo. El
 *   tile no se dibuja y el total del local no lo suma (pero sí lo cuenta como
 *   faltante, ver `valuacionDelTenant`). Mismo criterio que `textoDeMargen`
 *   en app/(app)/inventario/[id]/page.tsx y `margenDe` en
 *   lib/dashboard/metricas.ts: sin con qué calcular, no se inventa un número.
 * - CERO es **no hay mercadería**: stock en cero, o negativo. Con costo
 *   cargado se puede afirmar que lo que queda no vale nada, y es verdad.
 *
 * El clamp del negativo vive acá y en ningún otro lado. Vender sin stock no
 * está frenado (`lib/ventas/crear.ts`: "el stock puede quedar negativo y eso
 * no frena"), así que un artículo puede decir −2 — y eso es un error de carga
 * que `/inventario` ya avisa por su cuenta, no plata negativa que haya que
 * restarle al total del local.
 *
 * El resultado está en la moneda de `costo` —`MovimientoStock.monedaCosto`,
 * desde el ciclo del costo en dólares (2026-10-18)—, y por eso esta función no
 * recibe ninguna moneda: el costo se multiplica por una cantidad, y una
 * cantidad no tiene moneda, así que el producto queda en la moneda que traía
 * el costo. Quien lo muestra o lo suma es quien tiene que saber cuál es (la
 * ficha lo formatea con `precioEnSuMoneda`, `valuacionDelTenant` lo separa por
 * moneda). A diferencia del margen, que compara el costo CONTRA EL PRECIO y por
 * eso sí devuelve null cuando las monedas no coinciden.
 */
export function costoTotalDeArticulo(stock: Decimal, costo: Decimal | null): Decimal | null {
  if (costo === null) return null
  if (stock.lessThanOrEqualTo(0)) return CERO
  return redondearDinero(stock.mul(costo))
}

type PrismaDeTenant = ReturnType<typeof prismaParaTenant>

/** Cuánta plata hay parada en mercadería, y cuántos artículos quedaron afuera
 *  del número por no tener ningún costo cargado.
 *
 *  `total` es pesos y `totalUsd` dólares, cada artículo en la moneda de su
 *  último costo. Son dos números y no uno porque sumarlos exigiría una
 *  cotización, y el sistema no guarda ninguna en la que confiar (la cotización
 *  se tipea en cada venta, ciclo del precio en USD del 2026-08-29). */
export type Valuacion = { total: Decimal; totalUsd: Decimal; sinCosto: number }

/**
 * El costo del stock de todo el local.
 *
 * Exportada, y no inline en el Server Component del dashboard, por la razón de
 * siempre en este repo: un componente `async` que abre sesión no lo puede
 * llamar ningún test, y el `desactivadoEn: null` de acá abajo quedaría tan
 * desprotegido como el `anuladaEn` que el hallazgo I3 de la review del
 * rediseño mostró que se podía borrar dejando 785 tests en verde.
 *
 * DOS consultas y una suma en JavaScript, nunca un `$queryRaw` con un
 * `SUM(...)`: la extensión de lib/tenant/prisma.ts intercepta operaciones de
 * modelo, no raw queries, así que un raw sin el `set_config` de RLS devuelve
 * CERO FILAS EN SILENCIO — este repo ya lo documentó dos veces (el panel de
 * medios de /ventas y el gráfico de rotación de /inventario/[id]), y las dos
 * veces la salida fue agregar en JavaScript.
 *
 * El `distinct` es el mismo `DISTINCT ON` que ya usa `crearVenta`
 * (lib/ventas/crear.ts), con el mismo orden y el mismo desempate: `articuloId`
 * primero porque es la clave del distinct, después `creadoEn` descendente para
 * quedarse con el más reciente, y `id` (uuid(7), ordenable por tiempo) para
 * desempatar dos ingresos de la misma transacción, que comparten `creadoEn`
 * hasta el milisegundo.
 *
 * El filtro es `costoUnitario: { not: null }` y no "el ingreso más reciente":
 * un ingreso cargado sin costo no borra lo que se sabía del anterior. Y NO
 * filtra por moneda: el último costo es el ingreso más reciente con costo,
 * sea cual sea su moneda — un ingreso en dólares posterior a uno en pesos es
 * el costo que vale hoy, y el artículo entero pasa a sumar a `totalUsd`.
 */
export async function valuacionDelTenant(prisma: PrismaDeTenant): Promise<Valuacion> {
  const [articulos, costos] = await Promise.all([
    // Sólo PRODUCTO y sólo activos. Un servicio no tiene stock
    // (lib/inventario/stock.ts se lo rechaza) y un artículo dado de baja es
    // plata que el dueño ya decidió no vender — sumarla mezcla "cuánto tengo
    // invertido en lo que vendo" con "cuánto me quedé colgado".
    prisma.articulo.findMany({
      where: { tipo: 'PRODUCTO', desactivadoEn: null },
      select: { id: true, stock: true },
    }),
    prisma.movimientoStock.findMany({
      where: { motivo: 'INGRESO', costoUnitario: { not: null } },
      orderBy: [{ articuloId: 'asc' }, { creadoEn: 'desc' }, { id: 'desc' }],
      distinct: ['articuloId'],
      select: { articuloId: true, costoUnitario: true, monedaCosto: true },
    }),
  ])

  const costoPorArticulo = new Map(costos.map((m) => [m.articuloId, m]))

  let total = CERO
  let totalUsd = CERO
  let sinCosto = 0
  for (const a of articulos) {
    const ultimo = costoPorArticulo.get(a.id)
    const parcial = costoTotalDeArticulo(a.stock, ultimo?.costoUnitario ?? null)
    if (parcial === null) {
      // Cuenta artículos, no movimientos, y sólo los que tienen mercadería
      // encima: uno con stock cero o negativo aporta cero al total de todos
      // modos, así que decir que "falta" su costo infla el aviso con
      // artículos que no distorsionan ningún número.
      if (a.stock.greaterThan(0)) sinCosto += 1
      continue
    }
    if (ultimo?.monedaCosto === 'USD') totalUsd = totalUsd.add(parcial)
    else total = total.add(parcial)
  }
  return { total, totalUsd, sinCosto }
}
