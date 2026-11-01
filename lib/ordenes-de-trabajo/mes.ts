// Los meses de la ganancia son los del calendario del local, que es argentino:
// "noviembre" arranca a las 00:00 de Buenos Aires, no de UTC. Con UTC, una
// orden entregada el 31/10 a las 23:30 caería en noviembre.

const FORMATO_MES = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: '2-digit',
})

const NOMBRES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** `'2026-11'`, en hora argentina. */
export function mesEnCurso(ahora: Date): string {
  const partes = FORMATO_MES.formatToParts(ahora)
  const año = partes.find((p) => p.type === 'year')!.value
  const mes = partes.find((p) => p.type === 'month')!.value
  return `${año}-${mes}`
}

/** El mes de la URL si es un `AAAA-MM` real y no futuro; si no, el en curso.
 *  Comparar strings alcanza: el formato es de ancho fijo. El año arranca en
 *  1000: con `0500-12` el formato pasaba y el rango del mes salía inválido. */
export function mesValido(v: string | undefined, ahora: Date): string {
  const enCurso = mesEnCurso(ahora)
  if (v === undefined || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(v) || v > enCurso) return enCurso
  return v
}

/** [desde, hasta) del mes. Offset fijo -03:00: Argentina no tiene horario de
 *  verano desde 2009, así que el mes siempre arranca a las 03:00 UTC. */
export function rangoDelMes(mes: string): { desde: Date; hasta: Date } {
  return {
    desde: new Date(`${mes}-01T00:00:00-03:00`),
    hasta: new Date(`${mesSiguiente(mes)}-01T00:00:00-03:00`),
  }
}

function desplazar(mes: string, delta: number): string {
  const [año, m] = mes.split('-').map(Number)
  const total = año * 12 + (m - 1) + delta
  const a = Math.floor(total / 12)
  const mm = (total % 12) + 1
  // Con relleno aunque mesValido ya corte los años chicos: sin él, `0999-12`
  // daba `1000-01` bien pero `1000-01` hacia atrás daba `999-12`, que no es un
  // AAAA-MM y que `new Date` no parsea.
  return `${String(a).padStart(4, '0')}-${String(mm).padStart(2, '0')}`
}

export function mesAnterior(mes: string): string {
  return desplazar(mes, -1)
}

export function mesSiguiente(mes: string): string {
  return desplazar(mes, 1)
}

/** `'noviembre 2026'`. De un arreglo y no de `Intl`: es-AR agrega "de". */
export function nombreDelMes(mes: string): string {
  const [año, m] = mes.split('-').map(Number)
  return `${NOMBRES[m - 1]} ${año}`
}
