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

// Hasta 3 decimales pero sin ceros de relleno: "4" y no "4,000". Medio kilo de
// harina necesita los decimales; una unidad no tiene por qué mostrarlos.
const CANTIDAD = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 })

export function formatearCantidad(v: string): string {
  return CANTIDAD.format(Number(v))
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
