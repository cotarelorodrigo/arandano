/**
 * Los medios de pago y su forma ya lista para mostrar.
 *
 * **Este archivo no importa Prisma, y esa es toda su razón de ser.** Lo consume
 * `app/(app)/ventas/grafico.tsx`, que es un componente cliente: cualquier cosa
 * que llegue al navegador desde acá viaja en el bundle, y el cliente generado de
 * Prisma arrastra módulos de Node (`node:module` entre ellos). Con `ROTULO_MEDIO`
 * viviendo en `composicion.ts` —que sí necesita `Decimal` para sumar— el build
 * de producción fallaba con "the chunking context does not support external
 * modules", un error que ni el typecheck ni los tests ven porque los dos corren
 * en Node, donde `node:module` existe.
 *
 * La regla, entonces: lo que cruza al cliente vive acá; lo que suma plata vive
 * en `composicion.ts`.
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
 * Una barra del panel: un medio de pago, ya en pesos.
 *
 * Los montos son `string` y no `Decimal` porque el destinatario es un componente
 * cliente, y un `Decimal` no cruza el borde de serialización de React sin
 * convertirse en un objeto plano que ya no sabe sumar. Es la misma convención
 * que `formatearPrecio`, que recibe el `toString()` de la columna.
 */
export type Barra = {
  medio: Medio
  /** Lo cobrado en pesos. */
  ars: string
  /** Lo cobrado en dólares, convertido a pesos. */
  usd: string
  total: string
}

export type Composicion = {
  /** De mayor a menor. Los medios sin un solo pago no aparecen. */
  barras: Barra[]
  total: string
  /** Si hubo algún pago en dólares en el período. */
  hayDolares: boolean
}
