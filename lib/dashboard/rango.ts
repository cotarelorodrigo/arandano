import {
  sumarDias, primerDiaDelMes, primerDiaDelAnio, inicioDelDia, fechaLarga,
} from '@/lib/formato/fechas'

/** Los cuatro chips del segmentado (design/arandano.pen, nodo `toCZo`). */
export const RANGOS = ['hoy', '7dias', 'estemes', 'esteanio'] as const
export type Rango = (typeof RANGOS)[number]

export const ROTULO_RANGO: Record<Rango, string> = {
  hoy: 'Hoy',
  '7dias': '7 días',
  estemes: 'Este mes',
  esteanio: 'Este año',
}

/**
 * El chip del query string, o el default.
 *
 * El default es `estemes` y no `hoy` —que es el de /ventas— por dos motivos:
 * es el que la maqueta dibuja activo, y es el único con el que los cuatro
 * paneles tienen algo que mostrar la primera vez que alguien entra.
 */
export function rangoValido(v: string | undefined): Rango {
  return RANGOS.includes(v as Rango) ? (v as Rango) : 'estemes'
}

/** Las dos puntas de un período, ambas inclusive, en `YYYY-MM-DD`. */
export type Periodo = { desde: string; hasta: string }

export function periodoDeRango(rango: Rango, hoy: string): Periodo {
  switch (rango) {
    case 'hoy':
      return { desde: hoy, hasta: hoy }
    // Resta 6 y no 7: del 15 al 21 son 7 días con el 21 incluido, y restar 7
    // dejaría afuera el propio día de hoy. Misma cuenta que `rangoDeChip` en
    // app/(app)/ventas/page.tsx.
    case '7dias':
      return { desde: sumarDias(hoy, -6), hasta: hoy }
    case 'estemes':
      return { desde: primerDiaDelMes(hoy), hasta: hoy }
    case 'esteanio':
      return { desde: primerDiaDelAnio(hoy), hasta: hoy }
  }
}

/**
 * El mismo tramo del período calendario anterior — no la ventana previa del
 * mismo largo.
 *
 * La diferencia sólo aparece en `estemes` y `esteanio`, y es la que hace
 * cierto el rótulo que dibuja la maqueta. Un día 21 de agosto, la ventana
 * previa daría "del 20 al 31 de julio" y el chip seguiría diciendo "Comparado
 * con julio", que sería falso: es un tercio de julio. El tramo homólogo da
 * "del 1 al 21 de julio", que es lo que cualquiera entiende por comparar
 * contra el mes pasado a mitad de mes.
 */
export function periodoAnterior(rango: Rango, hoy: string): Periodo {
  switch (rango) {
    case 'hoy': {
      const ayer = sumarDias(hoy, -1)
      return { desde: ayer, hasta: ayer }
    }
    // Los 7 anteriores, sin solaparse con los 7 actuales: hasta el día previo
    // al `desde` del período vigente.
    case '7dias':
      return { desde: sumarDias(hoy, -13), hasta: sumarDias(hoy, -7) }
    case 'estemes': {
      const hasta = mismoDiaEn(mesAnterior(hoy), hoy)
      return { desde: primerDiaDelMes(hasta), hasta }
    }
    case 'esteanio': {
      const hasta = mismoDiaEn(`${Number(hoy.slice(0, 4)) - 1}-${hoy.slice(5, 7)}`, hoy)
      return { desde: primerDiaDelAnio(hasta), hasta }
    }
  }
}

/** `YYYY-MM` del mes anterior al de `iso`. */
function mesAnterior(iso: string): string {
  const anio = Number(iso.slice(0, 4))
  const mes = Number(iso.slice(5, 7))
  return mes === 1
    ? `${anio - 1}-12`
    : `${anio}-${String(mes - 1).padStart(2, '0')}`
}

/**
 * El mismo día del mes que `iso`, dentro del mes `anioMes` (`YYYY-MM`),
 * RECORTADO al último día que ese mes tiene.
 *
 * Sin el recorte, un 31 de marzo comparado contra febrero desbordaría al 3 de
 * marzo —que es lo que hace `Date` con `setUTCMonth`— y el período anterior
 * incluiría tres días del mes vigente, contándolos dos veces.
 */
function mismoDiaEn(anioMes: string, iso: string): string {
  const [anio, mes] = anioMes.split('-').map(Number)
  // Día 0 del mes SIGUIENTE es el último del mes pedido.
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  const dia = Math.min(Number(iso.slice(8, 10)), ultimo)
  return `${anioMes}-${String(dia).padStart(2, '0')}`
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** El texto del chip `git-compare-arrows` (nodo `unJCa`). */
export function rotuloDeComparacion(rango: Rango, hoy: string): string {
  const previo = periodoAnterior(rango, hoy)
  switch (rango) {
    case 'hoy':
      return 'Comparado con ayer'
    case '7dias':
      return 'Comparado con los 7 días previos'
    case 'estemes':
      return `Comparado con ${MESES[Number(previo.desde.slice(5, 7)) - 1]}`
    case 'esteanio':
      return `Comparado con ${previo.desde.slice(0, 4)}`
  }
}

/**
 * "1 al 21 de agosto de 2026" (nodo `w4NsZ`).
 *
 * Se apoya en `fechaLarga` para la punta derecha y sólo abrevia la izquierda
 * cuando las dos caen en el mismo mes: repetir "de agosto de 2026" dos veces
 * en una línea de 12 px es ruido, y omitirlo cuando el período cruza de mes
 * sería ambiguo.
 */
export function textoDelPeriodo(p: Periodo): string {
  const derecha = fechaLarga(p.hasta)
  if (p.desde === p.hasta) return derecha
  const mismoMes = p.desde.slice(0, 7) === p.hasta.slice(0, 7)
  const izquierda = mismoMes
    ? String(Number(p.desde.slice(8, 10)))
    : `${Number(p.desde.slice(8, 10))} de ${MESES[Number(p.desde.slice(5, 7)) - 1]}`
  return `${izquierda} al ${derecha}`
}

/**
 * El `where` que va a Prisma.
 *
 * `lt` sobre el día SIGUIENTE y nunca `lte` sobre `hasta`: `inicioDelDia` da
 * medianoche, así que un `lte` dejaría afuera todas las ventas del último día
 * del período — las 23 horas y 59 minutos que importan.
 */
export function filtroDe(p: Periodo): { creadoEn: { gte: Date; lt: Date } } {
  return {
    creadoEn: { gte: inicioDelDia(p.desde), lt: inicioDelDia(sumarDias(p.hasta, 1)) },
  }
}
