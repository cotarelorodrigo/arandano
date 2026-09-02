/**
 * Las primitivas de fecha del producto, ancladas a Buenos Aires.
 *
 * Vivían como funciones privadas de app/(app)/ventas/page.tsx. Salieron acá
 * cuando el dashboard se volvió su segundo consumidor: el huso es la clase de
 * detalle que, copiado, se arregla en un archivo y se queda roto en el otro —
 * el servidor está en Ashburn, así que un `new Date()` a las 22:00 de Buenos
 * Aires ya es el día siguiente en UTC.
 */

/**
 * El día de hoy en Buenos Aires, como `YYYY-MM-DD`.
 *
 * El servidor está en Ashburn: `new Date()` a las 22:00 de Buenos Aires ya es
 * el día siguiente en UTC, así que "las ventas de hoy" mostraría las de mañana
 * y ninguna de las de la tarde. El huso va declarado, igual que en
 * `formatearFecha`.
 */
export function hoyEnArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
}

/** `YYYY-MM-DD` al instante en que ese día empieza en Buenos Aires (UTC-3). */
export function inicioDelDia(fecha: string): Date {
  return new Date(`${fecha}T00:00:00-03:00`)
}

export const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * La fecha del query string, o hoy.
 *
 * Chequea el `Date` construido y no sólo la forma de los dígitos: `2026-13-45`
 * pasa cualquier regex de `\d{4}-\d{2}-\d{2}` y después da un `Invalid Date`
 * que Prisma rechaza sin que nadie lo atrape — un 500 servido desde algo que
 * alguien tipeó en la barra de direcciones. Es el mismo criterio que el clamp
 * de `?p`: lo malformado cae al default, no explota.
 */
export function fechaOhoy(valor: string | undefined, hoy: string): string {
  if (!valor || !ES_FECHA.test(valor)) return hoy
  return Number.isNaN(inicioDelDia(valor).getTime()) ? hoy : valor
}

/**
 * `YYYY-MM-DD` → "13 de agosto de 2026".
 *
 * Con el huso declarado, por lo mismo que `hoyEnArgentina`: sin él, el
 * `Date` de medianoche argentina se formatea en UTC y muestra el día anterior.
 */
export function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(inicioDelDia(iso))
}

/**
 * `YYYY-MM-DD` más/menos `dias` días de calendario.
 *
 * A medianoche UTC y no con `inicioDelDia` (que ancla a Buenos Aires): acá lo
 * único que importa son los componentes de la fecha, no el instante, así que
 * cualquier huso fijo sirve con tal de no cruzar un cambio de horario de
 * verano que Argentina no tiene. Usar un huso real metería esa complejidad de
 * vuelta sin necesidad.
 */
export function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** El primer día del mes de `iso`, mismo criterio que sumarDias. */
export function primerDiaDelMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/** El primer día del año de `iso`, mismo criterio que primerDiaDelMes. */
export function primerDiaDelAnio(iso: string): string {
  return `${iso.slice(0, 4)}-01-01`
}
