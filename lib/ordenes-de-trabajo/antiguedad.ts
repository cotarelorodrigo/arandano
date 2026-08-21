/**
 * `Date` → "DD/MM/AAAA", con el huso de Buenos Aires — mismo criterio que
 * `formatearFecha` (lib/formato/mostrar.ts), pero sin la hora: el subtítulo
 * de `/servicio-tecnico/[id]` dice hace cuántos días entró el equipo, y para
 * eso alcanza con el día.
 */
export function fechaCorta(v: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(v)
}

/**
 * Días corridos entre `creadoEn` y `ahora`, contando por fecha CALENDARIO de
 * Buenos Aires y no por milisegundos: un equipo que entró a las 23:50 y se
 * consulta a las 00:10 del día siguiente son 20 minutos de reloj, pero ya es
 * "un día" para quien lo tiene en el mostrador — así se cuenta el tiempo en
 * el local, no en horas exactas. El servidor corre en Ashburn (UTC-4/-5): sin
 * el huso declarado en las dos puntas, la medianoche que separa "hoy" de
 * "ayer" se corre unas horas y un equipo que entró después de esa medianoche
 * MAL calculada aparece con un día de más o de menos. Argentina no tiene DST
 * desde 2009, así que el offset `-03:00` es siempre el mismo: no hace falta
 * resolverlo dinámicamente.
 *
 * `ahora` es un parámetro, no `new Date()` adentro de la función: es lo que
 * permite testear el cruce de medianoche sin mockear el reloj del sistema.
 * En producción se llama con un solo argumento.
 */
export function diasEnElLocal(creadoEn: Date, ahora: Date = new Date()): number {
  const comoDiaDeBuenosAires = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d)
  const inicio = new Date(`${comoDiaDeBuenosAires(creadoEn)}T00:00:00-03:00`)
  const hoy = new Date(`${comoDiaDeBuenosAires(ahora)}T00:00:00-03:00`)
  return Math.round((hoy.getTime() - inicio.getTime()) / (24 * 60 * 60 * 1000))
}
