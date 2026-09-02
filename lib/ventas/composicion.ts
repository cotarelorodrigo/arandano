import { Prisma } from '@/generated/prisma/client'
import { redondearDinero } from './totales'
import type { Barra, Composicion, ComposicionPorMoneda, Medio, MonedaElegida } from './medios'

type Decimal = Prisma.Decimal

// Los rótulos y los tipos viven en ./medios porque los consume un componente
// CLIENTE y este archivo importa Prisma — ver el encabezado de ese archivo.
export type { Barra, Composicion, ComposicionPorMoneda, Medio }
export { MEDIOS, ROTULO_MEDIO } from './medios'

/**
 * Una fila del `groupBy` de pagos por `[medio, moneda, cotizacion, monto]`.
 *
 * **Es `monto` el que hace el trabajo, con `_count` en vez de `_sum`.** Es lo
 * que hace que el redondeo sea POR PAGO. Con `_sum` la base entregaba la suma
 * ya hecha y el redondeo caía sobre ella: dos pagos de US$ 1450,5555 dan
 * 1450,56 + 1450,56 = 2901,12 pago por pago, y 2901,11 sobre la suma. Un
 * centavo — pero `Venta.total` se arma con `totalDePagos`, que redondea cada
 * pago, así que ese centavo era el panel contradiciendo al tile "Total del
 * período" en la misma pantalla. Con el monto en la clave, todos los pagos de
 * un grupo son idénticos y `round(monto) × cantidad` es exactamente la suma
 * pago por pago.
 *
 * `cotizacion` sigue en la clave, y no hace falta sacarla: `componerPorMedio`
 * no la lee (Task 3 del ciclo del dashboard — ver su docblock, más abajo),
 * así que hoy sólo fragmenta de más un grupo que ya se recompone al sumar las
 * barras. Inofensivo, no un vestigio a limpiar: sacarla del `groupBy` de
 * `app/(app)/ventas/page.tsx` no cambiaría ningún resultado, sólo el número de
 * filas que trae la consulta.
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
 * Cómo entró la plata del período, por medio de pago y POR MONEDA.
 *
 * La pila la elige `Pago.moneda` y el importe es `Pago.monto` tal cual:
 * ninguna cotización entra en la cuenta, en ninguna de las cuatro
 * combinaciones de `(moneda, cubre)`. Es la definición correcta de lo que el
 * panel promete —qué se entregó físicamente— y lo que se entregó no necesita
 * ninguna conversión para nombrarse.
 *
 * **Esto ARREGLA un defecto que estuvo en producción.** La versión anterior
 * valuaba los pagos en dólares con `pesosEntregados`, o sea con
 * `Pago.cotizacion`, que vale 1 cuando el pago no cruza monedas: un pago de
 * US$ 300 en efectivo sobre un total en dólares aportaba 300 al largo de la
 * barra en vez de los ~445.500 que representa. Los importes que el panel
 * mostraba estaban bien —salían de `ars` y `usdCrudo`, los dos crudos—; lo que
 * mentía era la barra y el "N % del total", y para un local que cobra en
 * dólares en efectivo todas las barras quedaban cerca de cero.
 *
 * Con esto queda cerrada la costura que CLAUDE.md dejó abierta el 2026-08-30:
 * "Cómo entró la plata sigue convirtiendo los dólares a pesos, porque sus
 * barras necesitan una unidad común". Ya no la necesitan: cada moneda es su
 * propio panel.
 *
 * `_count` y el redondeo por pago se mantienen intactos (ver `FilaDePagos`).
 */
export function componerPorMedio(filas: FilaDePagos[]): ComposicionPorMoneda {
  const pilas: Record<MonedaElegida, Map<Medio, Decimal>> = { ars: new Map(), usd: new Map() }
  let hayDolares = false

  for (const f of filas) {
    if (f._count <= 0) continue
    const pila = f.moneda === 'USD' ? pilas.usd : pilas.ars
    if (f.moneda === 'USD') hayDolares = true
    // Redondear PRIMERO y multiplicar por la cantidad después, no al revés: es
    // lo que reproduce exactamente la suma pago por pago de `totalDePagos`.
    const suma = redondearDinero(f.monto).mul(f._count)
    pila.set(f.medio, (pila.get(f.medio) ?? new Prisma.Decimal(0)).add(suma))
  }

  return { ars: aComposicion(pilas.ars), usd: aComposicion(pilas.usd), hayDolares }
}

function aComposicion(pila: Map<Medio, Decimal>): Composicion {
  const barras: Barra[] = [...pila.entries()]
    .map(([medio, monto]) => ({ medio, monto: monto.toString() }))
    // Por plata y de mayor a menor: la barra más larga arriba es lo que hace
    // que el orden de lectura y el largo de las barras digan lo mismo.
    .sort((a, b) => Number(b.monto) - Number(a.monto))
  const total = barras.reduce((acc, b) => acc.add(b.monto), new Prisma.Decimal(0))
  return { barras, total: total.toString() }
}
