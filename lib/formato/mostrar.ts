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
