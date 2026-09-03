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
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'

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
 * Los medios distintos de una venta, en el orden en que se cobraron, cada
 * uno marcado con "· US$" si tuvo algún pago en dólares (fila #1040 del
 * relevamiento: "Efectivo · US$").
 *
 * **Vive acá y no en `app/(app)/ventas/page.tsx`, de donde salió** (Minor 5
 * de la review de Task 12, ciclo del dashboard): el CSV de ventas del
 * dashboard necesita la MISMA regla para su columna "Medios", y reimplementarla
 * ahí —en vez de importarla— es la clase de divergencia silenciosa que ya
 * rompió el selector de categoría duplicado entre el alta y la ficha de
 * artículo (CLAUDE.md, 2026-08-28). `/ventas/page.tsx` la importa de acá para
 * la celda "Medios" del listado; `app/(app)/dashboard/csv.ts` para la columna
 * homónima del CSV. Los dos son el mismo dato, así que tienen que ser la
 * misma función.
 *
 * **Decisión de UI que la maqueta no muestra**: ninguna de las siete filas de
 * ejemplo del relevamiento combina dos medios en la misma venta, así que no
 * hay ninguna pista de cómo resumir un pago partido entre efectivo y
 * tarjeta. Acá se listan los dos, separados por "+" — no es lo único
 * razonable ("Mixto" también lo sería), pero es el que no pierde información,
 * y `Pago` ya admite varios registros por venta a propósito (ver el
 * comentario de ese modelo).
 */
export function rotuloDeMedios(pagos: { medio: Medio; moneda: 'ARS' | 'USD' }[]): string {
  if (pagos.length === 0) return '—'
  const conDolares = new Map<Medio, boolean>()
  for (const p of pagos) {
    conDolares.set(p.medio, (conDolares.get(p.medio) ?? false) || p.moneda === 'USD')
  }
  return [...conDolares.entries()]
    .map(([medio, usd]) => ROTULO_MEDIO[medio] + (usd ? ' · US$' : ''))
    .join(' + ')
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

/**
 * El formateador que corresponde a la moneda elegida —nunca convierte, sólo
 * decide con qué función mostrar un número que YA está en esa moneda.
 *
 * Vivía duplicada dos veces: `formateadorDe` en
 * `app/(app)/dashboard/paneles.tsx` y la misma regla en línea, sin nombre, en
 * `app/(app)/ventas/grafico.tsx` (`moneda === 'ars' ? formatearPrecio :
 * formatearDolares`). Es la tercera instancia de la forma "dos copias que hay
 * que acordarse de sincronizar" que este ciclo cierra — junto con el
 * selector `$ / US$` mismo, unificado en `SelectorDeMonedaElegida`
 * (`components/selector-de-moneda-elegida.tsx` — distinto de
 * `SelectorDeMoneda` en `components/selector-de-moneda.tsx`, que es la
 * moneda de un ARTÍCULO, un concepto sin relación). `formatearPrecio` y
 * `formatearDolares` no arrastran Prisma (ver el docblock de este archivo),
 * así que importarlas acá no rompe la separación que ese docblock explica.
 */
export function formateadorDe(moneda: MonedaElegida): (v: string) => string {
  return moneda === 'usd' ? formatearDolares : formatearPrecio
}
