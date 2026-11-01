import { Prisma, type EstadoOrden } from '@/generated/prisma/client'
import { formatearPrecio, montoSinSigno } from '@/lib/formato/mostrar'

type Monto = Prisma.Decimal | null

/**
 * Cobrado menos costo, o `null` si falta cualquiera de los dos.
 *
 * `null` y cero no son lo mismo: un arreglo sin repuestos cuesta 0 y es un dato;
 * un costo sin cargar es un hueco, y restarlo como si fuera 0 mostraría una
 * ganancia inventada.
 */
export function ganancia(cobrado: Monto, costo: Monto): Prisma.Decimal | null {
  if (cobrado === null || costo === null) return null
  return cobrado.minus(costo)
}

export type Falta = 'costo' | 'cobrado' | 'ambos'

export function queFalta(cobrado: Monto, costo: Monto): Falta | null {
  if (cobrado === null && costo === null) return 'ambos'
  if (costo === null) return 'costo'
  if (cobrado === null) return 'cobrado'
  return null
}

export function fraseDeFalta(f: Falta): string {
  if (f === 'costo') return 'Falta cargar el costo'
  if (f === 'cobrado') return 'Falta cargar lo cobrado'
  return 'Falta cargar el costo y lo cobrado'
}

function monto(v: Monto): string {
  return v === null ? 'sin cargar' : formatearPrecio(v.toString())
}

function igual(a: Monto, b: Monto): boolean {
  if (a === null || b === null) return a === b
  return a.equals(b)
}

/**
 * La línea del historial cuando se corrige plata ya cargada: qué valía y qué
 * vale. `null` si nada cambió, para no ensuciar el historial con un guardado
 * que no tocó nada (5 y 5.00 son el mismo monto, de ahí `equals`).
 */
export function notaDePlata(cambios: {
  costo?: [Monto, Monto]
  cobrado?: [Monto, Monto]
}): string | null {
  const lineas: string[] = []
  if (cambios.costo && !igual(cambios.costo[0], cambios.costo[1]))
    lineas.push(`Costo: ${monto(cambios.costo[0])} → ${monto(cambios.costo[1])}`)
  if (cambios.cobrado && !igual(cambios.cobrado[0], cambios.cobrado[1]))
    lineas.push(`Cobrado: ${monto(cambios.cobrado[0])} → ${monto(cambios.cobrado[1])}`)
  return lineas.length > 0 ? lineas.join(' · ') : null
}

/** Un evento de plata es el que no mueve el estado: `desde === hasta`. */
export function esEventoDePlata(e: { desde: EstadoOrden | null; hasta: EstadoOrden }): boolean {
  return e.desde === e.hasta
}

/** Lo que se precarga en el campo de cobro: lo ya cobrado, si no el presupuesto,
 *  si no vacío. Mismo formato que `CardFallaYDiagnostico` para el estimado. */
export function precargaDelCobro(o: {
  montoCobrado: Monto
  montoEstimado: Monto
}): string {
  const base = o.montoCobrado ?? o.montoEstimado
  return base === null ? '' : montoSinSigno(formatearPrecio(base.toString()))
}
