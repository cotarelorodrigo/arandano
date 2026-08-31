import { Prisma } from '@/generated/prisma/client'
import type { Moneda } from '@/generated/prisma/client'
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'
import { redondearDinero, type Totales } from './totales'

type Decimal = Prisma.Decimal

/**
 * Un renglón de plata de las pantallas de venta: el importe ya formateado y,
 * cuando hay algo que distinguir, su rótulo.
 *
 * Sin rótulo es el caso de siempre —un número solo—; con rótulo es el
 * desglose "Vendido"/"Cobrado". La misma forma la consumen la columna Total
 * del listado y el tile "Total del período", que es lo que impide que las dos
 * se dibujen distinto.
 */
export type LineaDeImporte = { rotulo?: string; valor: string }

const CERO = () => ({ ars: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) })

/** La mercadería de una venta a precio de lista, partida por moneda. */
export function vendidoDeVenta(v: { total: Decimal; totalUsd: Decimal }): Totales {
  return { ars: v.total, usd: v.totalUsd }
}

/**
 * La plata que entró, apilada por la moneda en que se ENTREGÓ.
 *
 * **Por `Pago.moneda`, nunca por `Pago.cubre`**, y ahí está todo el ciclo: un
 * pago en pesos que cubre el total en dólares tiene `cubre = USD` porque paga
 * mercadería en dólares, pero lo que entró al cajón fueron pesos. Apilar por
 * `cubre` reproduce el defecto que este ciclo arregla — la venta de US$ 300
 * cobrada US$ 200 + pesos volvería a decir US$ 300.
 *
 * `Pago.monto` YA es `base + recargo` (`lib/ventas/crear.ts`), así que no hay
 * que sumarle `Venta.recargo` encima: sería contarlo dos veces.
 *
 * Y se lee crudo, sin `pesosEntregados` ni `montoEnPesos`: las dos convierten,
 * y acá el monto ya está en la unidad de su propia pila.
 */
export function cobradoDePagos(pagos: { moneda: Moneda; monto: Decimal }[]): Totales {
  return cobradoDeGrupos(pagos.map((p) => ({ moneda: p.moneda, monto: p.monto, _count: 1 })))
}

/**
 * La misma cuenta sobre filas de un `groupBy` con `_count`, para los agregados
 * del período.
 *
 * Redondea PRIMERO y multiplica por la cantidad después, no al revés: es lo
 * que reproduce exactamente la suma pago por pago, y el mismo motivo por el
 * que el `groupBy` lleva `monto` en la clave en vez de un `_sum` (ver
 * `FilaDePagos` en `./composicion.ts`).
 */
export function cobradoDeGrupos(
  grupos: { moneda: Moneda; monto: Decimal; _count: number }[],
): Totales {
  return grupos.reduce<Totales>((acc, g) => {
    if (g._count <= 0) return acc
    const suma = redondearDinero(g.monto).mul(g._count)
    return g.moneda === 'USD'
      ? { ars: acc.ars, usd: acc.usd.add(suma) }
      : { ars: acc.ars.add(suma), usd: acc.usd }
  }, CERO())
}

/** Si dos magnitudes coinciden en las DOS monedas. */
export function mismosTotales(a: Totales, b: Totales): boolean {
  return a.ars.equals(b.ars) && a.usd.equals(b.usd)
}

/**
 * LA regla de las tres pantallas: si el importe se muestra desglosado en
 * "Vendido" y "Cobrado", o como un número solo.
 *
 * Un número solo es el caso común —toda venta en pesos sin plan— y es lo que
 * hace que un local que no usa ni planes ni dólares no vea ninguna diferencia
 * respecto de antes de este ciclo.
 *
 * **Mira el recargo ADEMÁS de comparar las magnitudes**, y esa segunda mitad
 * parece redundante pero no lo es del todo: sin dólares sí lo es —`cobrado.ars`
 * es `total + recargo`, así que un recargo distinto de cero garantiza que
 * difieran—, pero en una venta mixta las dos pilas se arman por caminos
 * distintos y nada prueba que un recargo no pueda quedar compensado. Un
 * desglose de más no le hace daño a nadie; un recargo que se vuelve invisible
 * por una cancelación aritmética, sí.
 */
export function hayQueDesglosar(vendido: Totales, cobrado: Totales, recargo: Decimal): boolean {
  return !recargo.isZero() || !mismosTotales(vendido, cobrado)
}

/**
 * Una magnitud escrita: pesos primero, dólares después, unidos por " + ", y
 * **se omite el lado que está en cero**.
 *
 * Nada se convierte: cada moneda dice su propio número. La omisión limpia el
 * caso más común de este producto —antes de este ciclo una venta en dólares
 * se escribía "$ 0,00 + US$ 300,00"— y con las dos pilas en cero devuelve
 * "$ 0,00" y no un string vacío, que en una celda de plata se leería como un
 * dato faltante.
 */
export function formatearTotales(t: Totales): string {
  const partes: string[] = []
  if (!t.ars.isZero()) partes.push(formatearPrecio(t.ars.toString()))
  if (!t.usd.isZero()) partes.push(formatearDolares(t.usd.toString()))
  return partes.length === 0 ? formatearPrecio('0') : partes.join(' + ')
}

/**
 * El importe de una venta o de un período, listo para dibujar: un renglón sin
 * rótulo, o los dos del desglose.
 *
 * En el caso sin desglose se formatea `cobrado` y no `vendido`, aunque sean el
 * mismo número: es la plata que entró, que es lo que la pantalla contesta.
 */
export function lineasDeImporte(
  vendido: Totales,
  cobrado: Totales,
  recargo: Decimal,
): LineaDeImporte[] {
  if (!hayQueDesglosar(vendido, cobrado, recargo)) {
    return [{ valor: formatearTotales(cobrado) }]
  }
  return [
    { rotulo: 'Vendido', valor: formatearTotales(vendido) },
    { rotulo: 'Cobrado', valor: formatearTotales(cobrado) },
  ]
}
