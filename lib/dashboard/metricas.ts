import { Prisma } from '@/generated/prisma/client'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { cobradoDeGrupos, pagosDelPeriodo, type Totales } from '@/lib/ventas/cobrado'
import { redondearDinero } from '@/lib/ventas/totales'
import { filtroDe, type Periodo } from './rango'

type Decimal = Prisma.Decimal
type PrismaDeTenant = ReturnType<typeof prismaParaTenant>

/** El chip de variación: el porcentaje con signo, y si sube. */
export type Delta = { porcentaje: number; sube: boolean } | null

/**
 * La variación contra el período anterior, a un decimal.
 *
 * `null` cuando el período anterior fue CERO, y es una decisión: no hay
 * porcentaje de crecimiento contra nada. "+∞ %" y "+100 %" son las dos maneras
 * de inventarlo, y las dos se leen como un dato real. El chip no se dibuja y
 * el pie del tile dice "sin ventas en julio".
 *
 * De algo a cero sí devuelve delta (−100 %): ahí el denominador existe.
 */
export function delta(actual: Decimal, previo: Decimal): Delta {
  if (previo.isZero()) return null
  const pct = actual.minus(previo).div(previo).mul(100)
  const redondeado = Number(pct.toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP))
  return { porcentaje: redondeado, sube: redondeado >= 0 }
}

export type Margen = { monto: Decimal; porcentaje: Decimal } | null

/**
 * El margen del período y su porcentaje sobre la venta.
 *
 * Divide contra `vendidoConCosto` y NO contra `Venta.total`: las dos columnas
 * cubren exactamente los mismos ítems (ver `crearVenta`), así que el
 * porcentaje nunca mezcla mercadería con costo conocido contra mercadería sin
 * él. Con `total` en el denominador saldría subestimado sin que nada lo dijera.
 *
 * `null` con cero mercadería con costo: es distinto de un margen de cero, y el
 * tile lo dice con todas las letras en vez de mostrar "0 %". Mismo criterio
 * que `textoDeMargen` en app/(app)/inventario/[id]/page.tsx.
 */
export function margenDe(vendidoConCosto: Decimal, costo: Decimal): Margen {
  if (vendidoConCosto.isZero()) return null
  const monto = redondearDinero(vendidoConCosto.minus(costo))
  return { monto, porcentaje: monto.div(vendidoConCosto).mul(100) }
}

/**
 * El `skip`/`take` que traen la o las filas del medio de `n` ventas ordenadas.
 *
 * Existe para no traer el período entero: Postgres ordena igual, pero cruzan
 * una o dos filas en vez de decenas de miles. Es la respuesta a la
 * preocupación que CLAUDE.md ya dejó anotada para el panel de horarios.
 */
export function indicesDeMediana(n: number): { skip: number; take: number } | null {
  if (n <= 0) return null
  return n % 2 === 1
    ? { skip: (n - 1) / 2, take: 1 }
    : { skip: n / 2 - 1, take: 2 }
}

export type Metricas = {
  cobrado: Totales
  cobradas: number
  /** El ticket promedio EN PESOS. `null` cuando afirmarlo sería falso. */
  ticket: Decimal | null
  mediana: Decimal | null
  margen: Margen
}

/**
 * Las cuatro métricas de un período.
 *
 * Exportada, y no inline en el Server Component, por la razón de siempre: un
 * componente `async` que abre sesión no lo puede llamar ningún test, y la
 * regla "una venta anulada no es plata que entró" quedaría tan desprotegida
 * como la que el hallazgo I3 de la review del rediseño mostró que se podía
 * borrar dejando 785 tests en verde. Ese `anuladaEn: null` aparece cuatro
 * veces acá abajo, y las cuatro tienen que decir lo mismo.
 */
export async function metricasDelPeriodo(
  prisma: PrismaDeTenant,
  periodo: Periodo,
): Promise<Metricas> {
  const donde = { ...filtroDe(periodo), anuladaEn: null }

  const [grupos, cobradas, sumas] = await Promise.all([
    pagosDelPeriodo(prisma, filtroDe(periodo), false),
    prisma.venta.count({ where: donde }),
    prisma.venta.aggregate({
      where: donde,
      _sum: { costoArs: true, vendidoConCosto: true },
    }),
  ])

  const cobrado = cobradoDeGrupos(grupos)
  const cero = new Prisma.Decimal(0)

  return {
    cobrado,
    cobradas,
    ticket: ticketPromedio(cobrado, cobradas),
    // Va DESPUÉS del count y no en el Promise.all: `indicesDeMediana` necesita
    // el total para saber qué fila pedir.
    mediana: await medianaDeVentas(prisma, donde, cobradas),
    margen: margenDe(sumas._sum.vendidoConCosto ?? cero, sumas._sum.costoArs ?? cero),
  }
}

/**
 * El ticket promedio en pesos, o `null`.
 *
 * Misma guarda —y misma razón— que `pieDeCobradas` en app/(app)/ventas/page.tsx:
 * sin ninguna venta cobrada no hay promedio, y con CERO pesos cobrados sobre un
 * período que sí cobró dólares, "$ 0,00" no es una omisión sino una afirmación
 * falsa al lado de un tile que muestra dólares. No se agrega una segunda línea
 * en dólares: el promedio en dólares dividiría por un denominador que incluye
 * las ventas que no movieron un solo dólar.
 */
function ticketPromedio(cobrado: Totales, cobradas: number): Decimal | null {
  if (cobradas <= 0) return null
  if (cobrado.ars.isZero() && !cobrado.usd.isZero()) return null
  return redondearDinero(cobrado.ars.div(cobradas))
}

/**
 * La mediana de `Venta.total` del período, sin traer el período entero.
 *
 * Postgres ordena igual, pero cruzan una o dos filas en vez de decenas de
 * miles: es lo que hace que "Este año" no sea un problema de volumen. Es la
 * respuesta a la preocupación que CLAUDE.md ya dejó anotada para el panel de
 * horarios de /ventas.
 */
async function medianaDeVentas(
  prisma: PrismaDeTenant,
  donde: object,
  n: number,
): Promise<Decimal | null> {
  const indices = indicesDeMediana(n)
  if (!indices) return null
  const filas = await prisma.venta.findMany({
    where: donde,
    orderBy: { total: 'asc' },
    select: { total: true },
    ...indices,
  })
  if (filas.length === 0) return null
  // Con n par la mediana es el promedio de las dos del medio.
  const suma = filas.reduce((acc, f) => acc.add(f.total), new Prisma.Decimal(0))
  return redondearDinero(suma.div(filas.length))
}
