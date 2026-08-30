import { Prisma } from '@/generated/prisma/client'
import { pesosEntregados } from './totales'
import type { Barra, Composicion, Medio } from './medios'

type Decimal = Prisma.Decimal

// Los rótulos y los tipos viven en ./medios porque los consume un componente
// CLIENTE y este archivo importa Prisma — ver el encabezado de ese archivo.
export type { Barra, Composicion, Medio }
export { MEDIOS, ROTULO_MEDIO } from './medios'

/**
 * Una fila del `groupBy` de pagos por `[medio, moneda, cotizacion, monto]`.
 *
 * La cotización entra en la clave del agrupamiento a propósito: el monto de un
 * pago en dólares no vale nada sin ella, y dos pagos en dólares del mismo medio
 * pueden haberse tomado a cotizaciones distintas. Agrupar sin ella obligaría a
 * multiplicar una suma de dólares por UNA cotización elegida a dedo, que es un
 * número inventado.
 *
 * **Y el monto también, con `_count` en vez de `_sum`.** Es lo que hace que el
 * redondeo sea POR PAGO. Con `_sum` la base entregaba la suma ya hecha y el
 * redondeo caía sobre ella: dos pagos de US$ 1 a cotización 1450,5555 dan
 * 1450,56 + 1450,56 = 2901,12 pago por pago, y 2901,11 sobre la suma. Un
 * centavo — pero `Venta.total` se arma con `totalDePagos`, que redondea cada
 * pago, así que ese centavo era el panel contradiciendo al tile "Total del
 * período" en la misma pantalla. Con el monto en la clave, todos los pagos de
 * un grupo son idénticos y `round(monto × cotización) × cantidad` es
 * exactamente la suma pago por pago.
 *
 * El costo son más filas, y nunca más que pagos en el período: cada grupo es al
 * menos un pago. En la práctica son muchas menos, porque los importes se
 * repiten.
 */
export type FilaDePagos = {
  medio: Medio
  moneda: 'ARS' | 'USD'
  cotizacion: Decimal
  monto: Decimal
  _count: number
}

/**
 * Cómo entró la plata del período, por medio de pago.
 *
 * Todo se expresa en pesos —los dólares a la cotización a la que se tomó cada
 * pago, que es justamente para esto que `Pago.cotizacion` se guarda— porque una
 * barra que mezclara unidades no se podría comparar contra la de al lado.
 *
 * Suma `Pago.monto`, y **no** se lo toca en Task 8 (precios por forma de
 * pago) aunque esa task sí cambie qué suma el resto de `/ventas`. La razón:
 * `monto` YA es `base + recargo` desde que el motor cobra con plan (Task 4,
 * `lib/ventas/crear.ts`) — nunca fue sólo mercadería —, así que esta función
 * siempre sumó lo cobrado de verdad. Lo que sí se ajustó fue el tile "Total
 * del período" de `/ventas`, que hasta Task 8 sumaba sólo `Venta.total` (la
 * mercadería) y por eso dejaba de cerrar contra este panel apenas alguna
 * venta llevaba recargo. Ver el comentario del `groupBy` que arma `filas` en
 * `app/(app)/ventas/page.tsx` para el detalle completo de la decisión.
 *
 * La multiplicación pasa por `pesosEntregados`, y no se hace acá a mano, para
 * que este panel redondee en el mismo momento y de la misma forma que el
 * total de la venta: los dos números viven en la misma pantalla y se
 * comparan a ojo. Es `pesosEntregados` y no `montoEnPesos`: cada fila sale de
 * un pago YA GUARDADO, y un pago en pesos vale su monto aunque su cotización
 * no sea 1 — ver el docblock de `pesosEntregados` en `totales.ts`.
 */
export function componerPorMedio(filas: FilaDePagos[]): Composicion {
  const acumulado = new Map<Medio, { ars: Decimal; usd: Decimal; usdCrudo: Decimal }>()
  let hayDolares = false

  for (const f of filas) {
    if (f._count <= 0) continue

    // Redondear PRIMERO y multiplicar por la cantidad después, no al revés: es
    // lo que reproduce exactamente la suma pago por pago de `totalDePagos`.
    const enPesos = pesosEntregados(f).mul(f._count)
    const actual =
      acumulado.get(f.medio) ??
      { ars: new Prisma.Decimal(0), usd: new Prisma.Decimal(0), usdCrudo: new Prisma.Decimal(0) }

    if (f.moneda === 'USD') {
      hayDolares = true
      actual.usd = actual.usd.add(enPesos)
      // Sin `pesosEntregados` y sin cotización: son los dólares que entraron.
      // Con el mismo `_count` que el resto, que es lo que mantiene el
      // redondeo por pago (ver el docblock de FilaDePagos).
      actual.usdCrudo = actual.usdCrudo.add(f.monto.mul(f._count))
    } else {
      actual.ars = actual.ars.add(enPesos)
    }
    acumulado.set(f.medio, actual)
  }

  const barras: Barra[] = [...acumulado.entries()]
    .map(([medio, { ars, usd, usdCrudo }]) => ({
      medio,
      ars: ars.toString(),
      usd: usd.toString(),
      usdCrudo: usdCrudo.toString(),
      total: ars.add(usd).toString(),
    }))
    // Por plata y de mayor a menor: la barra más larga arriba es lo que hace
    // que el orden de lectura y el largo de las barras digan lo mismo.
    .sort((a, b) => Number(b.total) - Number(a.total))

  const total = barras.reduce((acc, b) => acc.add(b.total), new Prisma.Decimal(0))

  return { barras, total: total.toString(), hayDolares }
}
