/**
 * Los datos del carrito que muestra el héroe, y la aritmética que los mueve.
 *
 * POR QUÉ UN MÓDULO APARTE Y NO ADENTRO DE `retrato.tsx`. Ese archivo lleva
 * 'use client' desde el rediseño de la landing, y TODO export de un módulo
 * cliente le llega a un componente de servidor —o a un test que renderiza en
 * el servidor— como una referencia de cliente, no como el array. Es el mismo
 * problema que ya documenta `lib/formato/mostrar.ts` y por el que ese archivo
 * tampoco lleva la directiva. Acá viven los datos y las funciones puras; en
 * `retrato.tsx` vive la pantalla.
 *
 * POR QUÉ EL PRECIO ES UN STRING. Igual que en el resto del producto: es el
 * `toString()` de un `Decimal`, y `lib/formato/mostrar.ts` lo recibe así. Las
 * cuentas de acá son sobre pesos enteros, así que multiplicar y sumar en
 * `number` no pierde nada — pero el tipo se mantiene para que el día que un
 * precio traiga centavos no haya que cambiar la forma del dato.
 */

export type ItemDelCarrito = {
  id: string
  descripcion: string
  /** null: es un servicio, no lleva SKU de stock — mismo criterio que la fila
   *  real de `/vender`, que muestra "Servicio" en su lugar. */
  sku: string | null
  /** Cuántas unidades hay. null en un servicio: no descuenta stock, así que
   *  nunca puede faltar. Es lo que hace que el aviso de stock del retrato sea
   *  una regla y no un adorno fijo: aparece cuando la cantidad pedida supera
   *  lo que hay, igual que en el punto de venta de verdad. */
  stock: number | null
  precio: string
}

/**
 * Los cuatro ítems del frame `Sitio / Landing` → Hero → `Carrito real`
 * (design/arandano.pen, nodo `qjo7l`). Las cantidades iniciales — 1, 2, 1, 1 —
 * dan los mismos 103.900 que dibuja la maqueta.
 *
 * El `stock` no está en el `.pen`, porque una maqueta dibuja un estado y no una
 * regla. Los números elegidos hacen que el carrito enseñe algo apenas se lo
 * toca: la funda está en cero y por eso avisa desde el arranque (que es
 * exactamente lo que la maqueta dibuja), y el cargador tiene tres, así que
 * subir a cuatro hace aparecer el aviso donde antes no estaba.
 */
export const ITEMS: ItemDelCarrito[] = [
  { id: 'vidrio', descripcion: 'Vidrio templado 9H · iPhone 13', sku: '000412', stock: 8, precio: '12000' },
  { id: 'cargador', descripcion: 'Cargador 20W USB-C Baseus', sku: '000198', stock: 3, precio: '18500' },
  { id: 'funda', descripcion: 'Funda silicona iPhone 13 · Negra', sku: '000233', stock: 0, precio: '9900' },
  { id: 'mano-de-obra', descripcion: 'Cambio de módulo · Mano de obra', sku: null, stock: null, precio: '45000' },
]

/** Una línea del carrito: qué ítem y cuántas unidades. */
export type Linea = { id: string; cantidad: number }

export const LINEAS_INICIALES: Linea[] = [
  { id: 'vidrio', cantidad: 1 },
  { id: 'cargador', cantidad: 2 },
  { id: 'funda', cantidad: 1 },
  { id: 'mano-de-obra', cantidad: 1 },
]

export function itemPorId(id: string): ItemDelCarrito {
  const item = ITEMS.find((candidato) => candidato.id === id)
  // Las líneas se arman desde ITEMS, así que esto no puede pasar en la
  // pantalla. Tirar es mejor que devolver un ítem vacío: un carrito que
  // muestra una fila en blanco es peor que uno que no se dibuja.
  if (!item) throw new Error(`No existe el ítem "${id}" del carrito de la landing.`)
  return item
}

/** El subtotal de una línea, como string, para dárselo a `formatearPrecio`. */
export function subtotalDeLinea(linea: Linea): string {
  return String(Number(itemPorId(linea.id).precio) * linea.cantidad)
}

/** El total de la venta: la suma de los subtotales. */
export function totalDeLineas(lineas: Linea[]): string {
  return String(lineas.reduce((suma, linea) => suma + Number(subtotalDeLinea(linea)), 0))
}

/** Las unidades de la venta, que no es lo mismo que la cantidad de artículos. */
export function unidadesDeLineas(lineas: Linea[]): number {
  return lineas.reduce((suma, linea) => suma + linea.cantidad, 0)
}

/**
 * Si a esta línea le falta stock. Un servicio nunca: no descuenta nada.
 *
 * Es la misma pregunta que hace `/vender` al armar el carrito, y por eso el
 * aviso del retrato no es un adorno pegado a una fila: es una regla que
 * responde a lo que la persona acaba de hacer.
 */
export function faltaStock(linea: Linea): boolean {
  const { stock } = itemPorId(linea.id)
  return stock !== null && linea.cantidad > stock
}

/** El tope de unidades por línea. No es una regla del producto —el punto de
 *  venta real deja vender sin stock, avisando— sino del retrato: sin techo, el
 *  subtotal crece hasta romper la columna y la demo se ve rota en vez de viva. */
export const MAXIMO_POR_LINEA = 99
