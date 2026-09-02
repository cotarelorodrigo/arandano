import { Prisma } from '@/generated/prisma/client'
// `import type`, no de valor: mismo motivo que lib/ventas/cobrado.ts (Ruling
// de la review de esta task) — acá `prismaParaTenant` sólo aparece dentro de
// un `ReturnType<typeof ...>`. `delta` y `margenDe` son funciones puras que
// un componente cliente del dashboard va a querer importar directo; con un
// import de valor, ese import alcanzaría `lib/tenant/prisma.ts` para
// test/limite-cliente-servidor.test.ts y se llevaría el bundle de cliente.
import type { prismaParaTenant } from '@/lib/tenant/prisma'
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
  // El signo sale de comparar actual/previo SIN redondear, no del redondeado:
  // una baja mínima (p. ej. $1.000.000 contra $1.000.300) redondea a "-0", y
  // en JS `-0 >= 0` da `true` — el chip se dibujaba subiendo, en verde, al
  // lado de un número que en realidad bajó. `actual.gte(previo)` no tiene ese
  // problema: decide por la comparación real, y sigue dando `true` en el
  // empate (mismo caso que el test "sin movimiento el delta es cero").
  return { porcentaje: redondeado, sube: actual.gte(previo) }
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

export type Metricas = {
  cobrado: Totales
  cobradas: number
  /** El ticket promedio EN PESOS. `null` cuando afirmarlo sería falso. */
  ticket: Decimal | null
  margen: Margen
}

/**
 * Las cuatro métricas de un período.
 *
 * Exportada, y no inline en el Server Component, por la razón de siempre: un
 * componente `async` que abre sesión no lo puede llamar ningún test, y la
 * regla "una venta anulada no es plata que entró" quedaría tan desprotegida
 * como la que el hallazgo I3 de la review del rediseño mostró que se podía
 * borrar dejando 785 tests en verde. `anuladaEn: null` aparece UNA sola vez
 * acá abajo —en `donde`— y es a propósito: `donde` es la MISMA referencia que
 * usan `venta.count` y `venta.aggregate`, así que ninguna de las dos puede
 * perder el filtro por separado. La otra mitad de la regla, para "Cobrado",
 * vive en `pagosDelPeriodo` (`@/lib/ventas/cobrado`), con su propio test.
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

// SIN mediana, a propósito (Ruling M de la review de esta task — defecto del
// plan, no de lo implementado). La versión original ordenaba por
// `Venta.total`, pero esa columna es sólo la mitad en PESOS de la mercadería
// A PRECIO DE LISTA, mientras "Ticket promedio" —el tile de al lado— es
// `Σ Pago.monto`: lo COBRADO, recargo incluido, con los pesos que cubrieron un
// total en dólares. Son dos magnitudes distintas bajo un mismo tile. Una
// venta de un iPhone US$ 300 cobrada en dólares tiene `total = 0` en pesos, así
// que entraba a la mediana como CERO — con varias ventas en dólares en el
// período el tile mostraba "mediana $ 0,00" en la misma situación en la que
// `ticketPromedio` de arriba devuelve `null` con el argumento explícito de que
// "$ 0,00" ahí sería una afirmación falsa. Y con planes de pago sesga al
// revés: una venta de $10.000 en 12 cuotas al 40 % cobra $14.000, así que el
// promedio ($14.000) y la mediana ($10.000) de la MISMA venta se separaban por
// el recargo, no por ninguna diferencia real entre las ventas del período.
//
// No es una corrección barata: la mediana de lo COBRADO por venta exige
// ordenar por un agregado de `Pago` (`Σ monto` por `ventaId`), que Prisma no
// puede hacer sin `$queryRaw` —prohibido: la extensión del tenant intercepta
// operaciones de MODELO, no raw— o sin traer el período entero, que es
// justamente lo que este archivo existe para evitar. Cachear `cobradoArs` en
// `Venta` ya se evaluó y se descartó en un ciclo anterior, con el motivo
// escrito (ver CLAUDE.md, ciclo "Distinguir lo vendido de lo cobrado").
//
// El disparador para traerla de vuelta: que exista una magnitud de "lo
// cobrado por venta" que se pueda ORDENAR en la base sin traer el período
// entero — no una fecha.
