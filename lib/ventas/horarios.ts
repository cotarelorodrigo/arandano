/**
 * Cuándo vende el local: las ventas del período agrupadas por hora del día o
 * por día de la semana (design/arandano.pen, nodo `t93if9`).
 *
 * **Sin Prisma a propósito**, igual que `porcentajesQueSuman100`: recibe
 * fechas y devuelve barras, así que se prueba entera sin base — incluido lo
 * único que de verdad puede salir mal acá, que es el huso.
 *
 * La agregación se hace EN JAVASCRIPT y no con un `$queryRaw` con
 * `date_trunc`: la extensión de `lib/tenant/prisma.ts` intercepta operaciones
 * de MODELO, no raw queries, así que un raw no lleva el
 * `set_config('arandano.tenant_id')` y RLS lo devuelve VACÍO — no falla,
 * devuelve cero filas, que en un panel se lee como "no vendiste nada". Es el
 * mismo hallazgo que ya dejaron anotado el agregado de medios de pago de
 * `/ventas` y `agregarVentasPorMes` de `/inventario/[id]`. Y `groupBy` de
 * Prisma no sabe agrupar por hora, así que tampoco hay atajo por ahí.
 */

const ZONA = 'America/Argentina/Buenos_Aires'

/**
 * La hora del día en Buenos Aires, 0–23.
 *
 * `hourCycle: 'h23'` explícito y no `hour12: false`, que en varias locales
 * devuelve "24" para la medianoche en vez de "00" — un bug que aparecería una
 * sola vez por noche y sólo en un local que venda a esa hora.
 *
 * Devuelve la hora con cero a la izquierda ("08"), que `Number` resuelve sin
 * ayuda — no es un octal: `Number('08')` es 8, y el parseo octal de un string
 * con cero adelante murió con `parseInt` sin radix, que acá no se usa.
 *
 * El formatter se crea UNA vez, a nivel de módulo: construir un
 * `Intl.DateTimeFormat` por fila es el costo real de esta agregación, y son
 * miles de filas en un período largo.
 */
const HORA = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: 'numeric', hourCycle: 'h23' })

/**
 * El día en Buenos Aires como `YYYY-MM-DD`, para derivar de ahí el día de la
 * semana.
 *
 * Se pasa por la fecha y no por `weekday: 'short'` de `Intl` porque los
 * nombres cortos que devuelve una locale no son los que dibuja la maqueta
 * (varían con la versión de ICU, y en `es` vienen sin mayúscula inicial).
 * Con el `YYYY-MM-DD` en la mano, el mediodía UTC de ese día cae siempre
 * dentro del mismo día en cualquier huso, así que `getUTCDay()` es exacto.
 */
const FECHA = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA })

export const VISTAS = ['hora', 'dia'] as const
export type Vista = (typeof VISTAS)[number]

export const ROTULO_VISTA: Record<Vista, string> = { hora: 'Hora', dia: 'Día' }

/** La franja que se dibuja cuando el período no tuvo una sola venta: la de la maqueta. */
const HORA_DESDE_VACIO = 9
const HORA_HASTA_VACIO = 20

const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

export type BarraDeTiempo = {
  /** Clave estable para React y para las aserciones: la hora ('18') o el índice del día ('4'). */
  clave: string
  /** Lo que se dibuja debajo de la barra. */
  rotulo: string
  ventas: number
  /** La barra más alta, la única que pinta `--primary`. */
  pico: boolean
}

export type Horarios = {
  barras: BarraDeTiempo[]
  pie: string
}

/**
 * El `?vista` del query string. Cualquier cosa que no sea `dia` cae en
 * `hora`, sin romper nada: el mismo criterio con el que `fechaOhoy` trata una
 * fecha malformada y el clamp de `?p` una página imposible.
 */
export function vistaValida(v: string | undefined): Vista {
  return v === 'dia' ? 'dia' : 'hora'
}

function horaEnArgentina(d: Date): number {
  return Number(HORA.format(d))
}

/** 0 = lunes … 6 = domingo, en hora de Buenos Aires. */
function diaEnArgentina(d: Date): number {
  const domingoPrimero = new Date(`${FECHA.format(d)}T12:00:00Z`).getUTCDay()
  return (domingoPrimero + 6) % 7
}

/**
 * La barra más alta, con el empate resuelto por la primera: `>` estricto sobre
 * un recorrido en orden. Que el color y el pie salgan de la MISMA función es
 * lo que impide que se contradigan.
 */
function indiceDelPico(conteos: number[]): number {
  let pico = -1
  for (let i = 0; i < conteos.length; i++) {
    if (conteos[i] > 0 && (pico === -1 || conteos[i] > conteos[pico])) pico = i
  }
  return pico
}

function plural(n: number): string {
  return n === 1 ? '1 venta' : `${n} ventas`
}

export function agregarPorTiempo(fechas: Date[], vista: Vista): Horarios {
  const esHora = vista === 'hora'
  const indices = fechas.map((f) => (esHora ? horaEnArgentina(f) : diaEnArgentina(f)))

  // La franja de la vista Hora sale de los datos y no de las 9–20 que dibuja
  // la maqueta: con la franja fija, una venta a las 22 no aparecería en ningún
  // lado y el gráfico diría menos ventas de las que hubo, sin avisarlo. Sin
  // ninguna venta cae a la franja del frame, que es lo que hace que el panel
  // vacío se vea como está dibujado. La vista Día siempre son los siete.
  const desde = esHora ? (indices.length > 0 ? Math.min(...indices) : HORA_DESDE_VACIO) : 0
  const hasta = esHora ? (indices.length > 0 ? Math.max(...indices) : HORA_HASTA_VACIO) : 6

  const conteos = new Array(hasta - desde + 1).fill(0)
  for (const i of indices) conteos[i - desde] += 1

  const pico = indiceDelPico(conteos)

  const barras: BarraDeTiempo[] = conteos.map((ventas, i) => {
    const valor = desde + i
    return {
      clave: String(valor),
      rotulo: esHora ? String(valor) : DIAS_CORTOS[valor],
      ventas,
      pico: i === pico,
    }
  })

  if (pico === -1) return { barras, pie: 'Todavía no hubo ventas en este período.' }

  const cuando = esHora ? `a las ${desde + pico} h` : `el ${DIAS_LARGOS[desde + pico]}`
  return { barras, pie: `El pico es ${cuando}, con ${plural(conteos[pico])}.` }
}
