import type { EstadoOrden } from '@/generated/prisma/client'

/**
 * Los ocho estados, en el orden en que se recorren. El orden importa: es el que
 * usa el tablero para ordenar sus contadores.
 */
export const ESTADOS: readonly EstadoOrden[] = [
  'RECIBIDO',
  'EN_DIAGNOSTICO',
  'PRESUPUESTADO',
  'EN_REPARACION',
  'LISTO',
  'ENTREGADO',
  'SIN_REPARACION',
  'RECHAZADO',
]

/**
 * Qué transiciones son legales. Es la fuente de verdad: la pantalla dibuja los
 * botones a partir de esta tabla, pero el server action la vuelve a consultar
 * antes de escribir. Una UI que esconde un botón no es una validación.
 *
 * `SIN_REPARACION` y `RECHAZADO` NO son terminales, y ésa es la decisión que
 * más define el modelo: el equipo sigue en el estante hasta que el cliente lo
 * viene a buscar. El único estado final es ENTREGADO — se entrega arreglado,
 * sin arreglar, o porque el cliente no aceptó el presupuesto. Que se haya
 * entregado sin arreglar sale de la bitácora, que es para lo que existe.
 */
export const TRANSICIONES: Record<EstadoOrden, readonly EstadoOrden[]> = {
  RECIBIDO: ['EN_DIAGNOSTICO', 'PRESUPUESTADO', 'EN_REPARACION', 'SIN_REPARACION'],
  EN_DIAGNOSTICO: ['PRESUPUESTADO', 'EN_REPARACION', 'SIN_REPARACION'],
  PRESUPUESTADO: ['EN_REPARACION', 'RECHAZADO', 'SIN_REPARACION'],
  // A PRESUPUESTADO: se abrió el equipo y apareció algo más.
  EN_REPARACION: ['LISTO', 'PRESUPUESTADO', 'SIN_REPARACION'],
  // A EN_REPARACION: no quedó bien, y vuelve al banco antes de que lo retiren.
  LISTO: ['ENTREGADO', 'EN_REPARACION'],
  // A EN_REPARACION: la garantía. Hoy eso es una orden nueva en el cuaderno,
  // que pierde la historia de la anterior.
  ENTREGADO: ['EN_REPARACION'],
  SIN_REPARACION: ['ENTREGADO'],
  RECHAZADO: ['ENTREGADO'],
}

export function puedeTransicionar(desde: EstadoOrden, hasta: EstadoOrden): boolean {
  return TRANSICIONES[desde].includes(hasta)
}

/**
 * Lo que sigue en el local. Es el filtro por defecto del tablero: el equipo
 * entregado ya no es problema de nadie.
 */
export const ABIERTOS: readonly EstadoOrden[] = ESTADOS.filter((e) => e !== 'ENTREGADO')

/** Cómo se lee cada estado en pantalla. Nadie tiene que ver EN_DIAGNOSTICO. */
export const NOMBRE_ESTADO: Record<EstadoOrden, string> = {
  RECIBIDO: 'Recibido',
  EN_DIAGNOSTICO: 'En diagnóstico',
  PRESUPUESTADO: 'Presupuestado',
  EN_REPARACION: 'En reparación',
  LISTO: 'Listo',
  ENTREGADO: 'Entregado',
  SIN_REPARACION: 'Sin reparación',
  RECHAZADO: 'Rechazado',
}
