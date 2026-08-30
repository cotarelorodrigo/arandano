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
 * Una barra del panel: un medio de pago, ya en pesos.
 *
 * Los montos son `string` y no `Decimal` — ya no porque el destinatario sea un
 * componente cliente (`grafico.tsx` dejó de serlo este ciclo, ver el
 * comentario de arriba), sino porque siguen siendo la salida FINAL de una
 * suma: lo único que un consumidor hace con ellos es mostrarlos, con
 * `formatearPrecio`, que recibe el `toString()` de la columna. Guardar el
 * tipo como `string` es lo que impide que un consumidor futuro —cliente o
 * servidor— le pida más aritmética a un valor que ya terminó de sumarse.
 *
 * `ars` tiene consumidor de producción: la línea de pesos del rótulo de cada
 * medio en `GraficoDeMedios`. `usd` **no tiene consumidor de producción hoy**
 * —sólo lo lee `lib/ventas/composicion.test.ts`, para verificar que la
 * separación por moneda no se mezcle antes de sumarse en `total`—. Se quedan:
 * sostienen esa verificación con más granularidad que mirar sólo `total` (un
 * bug que cruzara pesos y dólares pero sumara igual no se vería ahí), y son
 * el dato que un panel futuro necesitaría para, por ejemplo, mostrar el
 * desglose por moneda en vez de convertir todo a pesos. Sacar `usd` es una
 * decisión aparte, no un descuido de este ciclo.
 */
export type Barra = {
  medio: Medio
  /** Lo cobrado en pesos. */
  ars: string
  /** Lo cobrado en dólares, convertido a pesos. */
  usd: string
  /**
   * Lo cobrado en dólares, SIN convertir: la segunda línea del rótulo de cada
   * medio (design/arandano.pen, nodo `l4Inhd`).
   *
   * A diferencia de `usd` —que está en pesos y sigue sin consumidor de
   * producción—, éste sí tiene uno: `GraficoDeMedios`. Y es
   * justamente el número que `usd` no puede dar, porque `usd` ya pasó por la
   * cotización de cada pago.
   *
   * Un pago en PESOS que cubre el total en dólares no entra acá: la línea
   * dice qué moneda entró al cajón, y esos fueron pesos. Misma regla que
   * `pesosEntregados` usa para decidir si multiplica.
   */
  usdCrudo: string
  total: string
}

export type Composicion = {
  /** De mayor a menor. Los medios sin un solo pago no aparecen. */
  barras: Barra[]
  total: string
  /**
   * Si hubo algún pago en dólares en el período. **Tampoco tiene consumidor
   * de producción hoy** —la nota "convertidos a la cotización de cada pago"
   * de `grafico.tsx` se muestra siempre, no sólo cuando este campo es
   * `true`—, mismo criterio que `ars`/`usd`: queda documentado y sin usar en
   * vez de sacarse en silencio, porque es exactamente el dato que haría
   * falta para condicionar esa nota — decisión de un ciclo aparte, no de
   * éste.
   */
  hayDolares: boolean
}
