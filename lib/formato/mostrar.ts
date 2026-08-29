// Sin 'use client': lo importan componentes de SERVIDOR. Ver el porqué largo en
// el plan — un export de un módulo cliente llega al servidor como proxy.

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
})

/** Recibe el `toString()` de un `Decimal`, no un `number`: la conversión a
 *  flotante pasa una sola vez y acá, donde el valor ya sólo se va a mirar. */
export function formatearPrecio(v: string): string {
  return PESOS.format(Number(v))
}

const DOLARES = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

/**
 * Un monto en dólares, con su propio símbolo.
 *
 * Existe porque `formatearPrecio` está cableado a ARS y ya emite `$`: anteponerle
 * a mano un "US$ " daba `US$ $ 0,80`. El valor era correcto y el cartel se leía
 * roto, que en una pantalla de plata es suficiente para desconfiar del número.
 */
export function formatearDolares(v: string): string {
  return DOLARES.format(Number(v))
}

/**
 * El precio de un artículo, en su moneda y SIN equivalente en pesos.
 *
 * Fuera de una venta no hay ninguna cotización de la cual derivarlo, y un
 * número inventado es peor que ninguno — la misma regla por la que el chip de
 * cotización del header de /vender muestra "—" en vez de fabricar un valor.
 */
export function precioEnSuMoneda(precio: string, moneda: 'ARS' | 'USD'): string {
  return moneda === 'USD' ? formatearDolares(precio) : formatearPrecio(precio)
}

// Hasta 3 decimales pero sin ceros de relleno: "4" y no "4,000". Medio kilo de
// harina necesita los decimales; una unidad no tiene por qué mostrarlos.
const CANTIDAD = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 })

export function formatearCantidad(v: string): string {
  return CANTIDAD.format(Number(v))
}

/**
 * El recargo de un plan de pago, con su signo siempre a la vista.
 *
 * `signDisplay: 'exceptZero'` y no el default: el porcentaje del plan LLEVA
 * signo —+40 % recarga, −10 % descuenta por pago contado— y un `40 %` pelado al
 * lado de un `−10 %` deja la mitad de la tabla sin decir de qué lado está. El
 * cero no lo lleva, porque un plan sin recargo no es ni una cosa ni la otra.
 *
 * Hasta tres decimales, sin ceros de relleno: es la escala de `Decimal(6,3)`
 * que la columna guarda —los costos financieros reales vienen así— y un
 * `40,000 %` sería ruido en una celda que se escanea.
 */
const PORCENTAJE = new Intl.NumberFormat('es-AR', {
  style: 'percent',
  maximumFractionDigits: 3,
  signDisplay: 'exceptZero',
})

export function formatearPorcentaje(v: string): string {
  // Dividido por 100 porque `style: 'percent'` espera la fracción, no el
  // número que se escribe delante del símbolo.
  return PORCENTAJE.format(Number(v) / 100)
}

// El servidor está en Ashburn. Sin declarar el huso, un movimiento de las 22:00
// de Buenos Aires aparecería con fecha del día siguiente, y el historial de un
// cierre de jornada quedaría partido en dos días.
const FECHA = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
})

export function formatearFecha(v: Date): string {
  return FECHA.format(v)
}

// Mismo huso que FECHA y por la misma razón: sin declararlo, "14:28" de
// Buenos Aires se lee como la hora de Ashburn. Existe aparte de
// formatearFecha() porque el listado de /ventas (design/arandano.pen, nodo
// `ZjnhR`) pide la columna "Hora" sola, sin la fecha repetida en cada fila —
// la fecha ya está una sola vez en el subtítulo de la pantalla.
// hour12: false a propósito: design/arandano.pen escribe "14:28", 24 horas,
// no "2:28 p. m." — que es lo que timeStyle: 'short' da por default en es-AR.
const HORA = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
})

export function formatearHora(v: Date): string {
  return HORA.format(v)
}

/**
 * `Date` → "21/08/2026": día/mes/año, los tres de dos y cuatro dígitos fijos.
 *
 * Ni `formatearFecha` (que da "21/8/26" con año a dos dígitos y hora en
 * 12 horas, pensado para lectura corrida) ni `formatearHora` alcanzan solos
 * para el panel Resumen de /ventas/[id] (design/arandano.pen, nodo `V3VcI8`):
 * "21/08/2026 · 14:28" pide fecha y hora por separado, unidas con su propio
 * separador — se compone afuera con `formatearHora`, no acá, para no crear un
 * tercer formateador que sólo sirva para ESTE armado puntual.
 */
const FECHA_CORTA = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Argentina/Buenos_Aires',
})

export function formatearFechaCorta(v: Date): string {
  return FECHA_CORTA.format(v)
}

/**
 * Lo que devuelve `formatearPrecio`/`formatearDolares`, sin el signo de
 * moneda adelante — para las superficies que ya dicen de qué moneda se
 * trata por otro lado (el rótulo "USD" del chip de cotización en
 * `app/(app)/vender/caja.tsx`, el "$" que la banda del total de
 * `app/(app)/vender/punto-de-venta.tsx` pinta como SU PROPIO elemento) y en
 * las que anteponer el signo de nuevo duplicaría el símbolo o compitiría con
 * el que ya está al lado.
 *
 * "Todo lo que no es dígito al principio" y no una lista fija de símbolos:
 * el símbolo varía con la moneda (pesos, dólares) y con el locale de ICU,
 * así que esa regla no hay que retocarla si el formateador cambia. Extraída
 * acá y no repetida en cada pantalla —estaba duplicada en las dos de
 * arriba, hallazgo de la review final del rediseño de /vender.
 */
export function montoSinSigno(formateado: string): string {
  return formateado.replace(/^\D+/, '')
}
