import type { MedioPago } from '@/generated/prisma/client'
import { prismaParaTenant } from '@/lib/tenant/prisma'

/**
 * Un plan tal como lo miran las pantallas.
 *
 * `porcentaje` es `string` y no `Decimal` por lo mismo que `ArticuloVendible.precio`
 * (`lib/ventas/buscar.ts`): esto cruza a un componente cliente, y el `Decimal`
 * de Prisma no puede viajar sin arrastrar el cliente de Prisma al bundle.
 */
export type PlanVisible = {
  id: string
  nombre: string
  medio: MedioPago
  cuotas: number
  porcentaje: string
  orden: number
  desactivadoEn: Date | null
}

export async function planesDelTenant(
  tenantId: string,
  opciones: { incluirDesactivados?: boolean } = {},
): Promise<PlanVisible[]> {
  const filas = await prismaParaTenant(tenantId).planDePago.findMany({
    where: opciones.incluirDesactivados ? {} : { desactivadoEn: null },
    // Por medio primero: el mostrador ofrece los planes de UN medio por vez, y
    // el `orden` que fija el dueño manda adentro de cada uno. El nombre
    // desempata para que el listado no baile entre dos cargas.
    orderBy: [{ medio: 'asc' }, { orden: 'asc' }, { nombre: 'asc' }],
  })
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    medio: f.medio,
    cuotas: f.cuotas,
    porcentaje: f.recargoPorcentaje.toString(),
    orden: f.orden,
    desactivadoEn: f.desactivadoEn,
  }))
}
