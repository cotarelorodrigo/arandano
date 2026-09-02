/**
 * Los medios de pago y su forma ya lista para mostrar.
 *
 * **Este archivo no importa Prisma, y esa es toda su razón de ser.** La
 * consumía `app/(app)/ventas/grafico.tsx` como componente cliente cuando esto
 * se escribió: cualquier cosa que llegara al navegador desde acá viajaba en el
 * bundle, y el cliente generado de Prisma arrastra módulos de Node
 * (`node:module` entre ellos). Con `ROTULO_MEDIO` viviendo en `composicion.ts`
 * —que sí necesita `Decimal` para sumar— el build de producción fallaba con
 * "the chunking context does not support external modules", un error que ni
 * el typecheck ni los tests ven porque los dos corren en Node, donde
 * `node:module` existe.
 *
 * **Este ciclo le sacó el `'use client'` a `grafico.tsx`** (`Progress` ya no
 * mide nada del lado del navegador, ver el comentario de ese archivo), así
 * que hoy ningún consumidor —`page.tsx`, `[id]/page.tsx`, `grafico.tsx`— es de
 * cliente. La separación se queda igual de todos modos: ninguno de los tres
 * necesita `Decimal` para lo que muestra (rótulos, nombres, montos ya
 * convertidos a `string`), así que no hay motivo para mezclarlos con
 * `composicion.ts` — y si el día de mañana vuelve a existir un consumidor de
 * cliente, ya está aislado sin tener que mover nada.
 *
 * La regla, entonces: lo que no necesita sumar plata vive acá; lo que sí, en
 * `composicion.ts`.
 */

/** En el orden del enum `MedioPago` del schema. */
export const MEDIOS = [
  'EFECTIVO',
  'TRANSFERENCIA',
  'TARJETA_DEBITO',
  'TARJETA_CREDITO',
] as const

export type Medio = (typeof MEDIOS)[number]

export const ROTULO_MEDIO: Record<Medio, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA_DEBITO: 'Débito',
  TARJETA_CREDITO: 'Crédito',
}

/**
 * El cliente de una venta de mostrador, sin identificar — literal en
 * `design/arandano.pen` (el listado de /ventas y el panel Resumen de
 * /ventas/[id]). Un solo lugar y no un literal repetido en cada pantalla que
 * lo muestra.
 */
export const CONSUMIDOR_FINAL = 'Consumidor final'

/**
 * Una barra del panel: un medio de pago y lo que entró por él, EN UNA SOLA
 * MONEDA.
 *
 * Antes eran cuatro campos (`ars`, `usd`, `usdCrudo`, `total`) porque el panel
 * mezclaba las dos monedas en una barra, convirtiendo los dólares con
 * `Pago.cotizacion`. Eso resultó imposible de sostener: `cotizacion` vale 1
 * cuando el pago no cruza monedas —a propósito, ver `cotizacionParaElCruce` en
 * app/(app)/vender/punto-de-venta.tsx—, así que un pago de US$ 300 en efectivo
 * aportaba 300 a una barra de pesos. Hoy hay una composición por moneda y
 * ninguna cotización entra en la cuenta.
 *
 * `monto` es `string` y no `Decimal` por lo mismo de siempre: es la salida
 * FINAL de una suma, y lo único que un consumidor hace con ella es mostrarla.
 */
export type Barra = { medio: Medio; monto: string }

export type Composicion = {
  /** De mayor a menor. Los medios sin un solo pago en esta moneda no aparecen. */
  barras: Barra[]
  total: string
}

/** Las dos pilas del período, sin ninguna conversión entre ellas. */
export type ComposicionPorMoneda = {
  ars: Composicion
  usd: Composicion
  /** Si hubo algún pago en dólares. Es lo que decide si el selector se dibuja. */
  hayDolares: boolean
}

/** Qué pila mira la pantalla. Viaja en la URL como `?moneda`. */
export type MonedaElegida = 'ars' | 'usd'

export function monedaValida(v: string | undefined): MonedaElegida {
  return v === 'usd' ? 'usd' : 'ars'
}
