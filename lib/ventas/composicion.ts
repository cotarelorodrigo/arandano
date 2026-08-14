import { Prisma } from '@/generated/prisma/client'
import { montoEnPesos } from './totales'
import type { Barra, Composicion, Medio } from './medios'

type Decimal = Prisma.Decimal

// Los rótulos y los tipos viven en ./medios porque los consume un componente
// CLIENTE y este archivo importa Prisma — ver el encabezado de ese archivo.
export type { Barra, Composicion, Medio }
export { MEDIOS, ROTULO_MEDIO } from './medios'

/**
 * Una fila del `groupBy` de pagos por `[medio, moneda, cotizacion]`.
 *
 * La cotización entra en la clave del agrupamiento a propósito: el monto de un
 * pago en dólares no vale nada sin ella, y dos pagos en dólares del mismo medio
 * pueden haberse tomado a cotizaciones distintas. Agrupar sin ella obligaría a
 * multiplicar una suma de dólares por UNA cotización elegida a dedo, que es un
 * número inventado. El costo es más filas, y son pocas: una por cotización
 * distinta del período.
 */
export type FilaDePagos = {
  medio: Medio
  moneda: 'ARS' | 'USD'
  cotizacion: Decimal
  _sum: { monto: Decimal | null }
}

/**
 * Cómo entró la plata del período, por medio de pago.
 *
 * Todo se expresa en pesos —los dólares a la cotización a la que se tomó cada
 * pago, que es justamente para esto que `Pago.cotizacion` se guarda— porque una
 * barra que mezclara unidades no se podría comparar contra la de al lado.
 *
 * La multiplicación pasa por `montoEnPesos`, y no se hace acá a mano, para que
 * este panel redondee en el mismo momento y de la misma forma que el total de
 * la venta: los dos números viven en la misma pantalla y se comparan a ojo.
 */
export function componerPorMedio(filas: FilaDePagos[]): Composicion {
  const acumulado = new Map<Medio, { ars: Decimal; usd: Decimal }>()
  let hayDolares = false

  for (const f of filas) {
    // `_sum` de un grupo vacío es null. Prisma no devuelve grupos vacíos, pero
    // el tipo lo admite y un `null` acá se propagaría como NaN hasta la pantalla.
    const monto = f._sum.monto
    if (!monto) continue

    const enPesos = montoEnPesos(monto, f.cotizacion)
    const actual =
      acumulado.get(f.medio) ?? { ars: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) }

    if (f.moneda === 'USD') {
      hayDolares = true
      actual.usd = actual.usd.add(enPesos)
    } else {
      actual.ars = actual.ars.add(enPesos)
    }
    acumulado.set(f.medio, actual)
  }

  const barras: Barra[] = [...acumulado.entries()]
    .map(([medio, { ars, usd }]) => ({
      medio,
      ars: ars.toString(),
      usd: usd.toString(),
      total: ars.add(usd).toString(),
    }))
    // Por plata y de mayor a menor: la barra más larga arriba es lo que hace
    // que el orden de lectura y el largo de las barras digan lo mismo.
    .sort((a, b) => Number(b.total) - Number(a.total))

  const total = barras.reduce((acc, b) => acc.add(b.total), new Prisma.Decimal(0))

  return { barras, total: total.toString(), hayDolares }
}
