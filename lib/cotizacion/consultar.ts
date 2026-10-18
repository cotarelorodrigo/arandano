import { prismaParaTenant } from '@/lib/tenant/prisma'
import type { CotizacionDelLocal } from './reglas'

/**
 * Lo que las pantallas leen de la cotización del dólar del local.
 *
 * El valor viaja como `string` (el `toString()` del Decimal) y no como
 * `Decimal`, por lo mismo que `PlanVisible.porcentaje`: el chip de `/vender` y
 * la calculadora del canje son componentes cliente, y el `Decimal` de Prisma no
 * cruza sin arrastrar el cliente de Prisma al bundle.
 */

/** Una carga del historial: valor, cuándo y quién. El nombre y no el id: es
 *  lo que el diálogo muestra, y un usuario desactivado sigue teniendo nombre. */
export type CargaDeCotizacion = CotizacionDelLocal & { id: string; cargadaPor: string }

/** Cuántas cargas muestra el diálogo del chip: las del spec. */
export const CARGAS_VISIBLES = 10

// La más nueva primero, con desempate por `id` (uuid(7), ordenable por
// tiempo): `creada_en` es la hora de INICIO de la transacción, así que dos
// cargas que empezaron en el mismo milisegundo no tienen otro orden. Mismo
// criterio que el historial de movimientos de la ficha.
const MAS_NUEVA_PRIMERO = [{ creadaEn: 'desc' as const }, { id: 'desc' as const }]

/**
 * La cotización vigente del local —la más reciente—, o `null` si nunca se
 * cargó ninguna. Sin juzgar si es de hoy: eso lo decide quien la usa, con
 * `lib/cotizacion/reglas.ts`, porque cada lugar hace algo distinto con una
 * vieja (el cobro no la precarga; el margen la usa y dice la fecha).
 */
export async function cotizacionVigente(tenantId: string): Promise<CotizacionDelLocal | null> {
  const fila = await prismaParaTenant(tenantId).cotizacionDelDolar.findFirst({
    orderBy: MAS_NUEVA_PRIMERO,
    select: { valor: true, creadaEn: true },
  })
  return fila ? { valor: fila.valor.toString(), creadaEn: fila.creadaEn } : null
}

/**
 * Las últimas `CARGAS_VISIBLES` cargas, la más nueva primero. La primera ES la
 * vigente: el diálogo no hace una segunda consulta para ella, y así no pueden
 * contradecirse si alguien carga otra entre las dos.
 */
export async function historialDeCotizaciones(tenantId: string): Promise<CargaDeCotizacion[]> {
  const filas = await prismaParaTenant(tenantId).cotizacionDelDolar.findMany({
    orderBy: MAS_NUEVA_PRIMERO,
    take: CARGAS_VISIBLES,
    select: { id: true, valor: true, creadaEn: true, cargadaPor: { select: { nombre: true } } },
  })
  return filas.map((f) => ({
    id: f.id,
    valor: f.valor.toString(),
    creadaEn: f.creadaEn,
    cargadaPor: f.cargadaPor.nombre,
  }))
}
