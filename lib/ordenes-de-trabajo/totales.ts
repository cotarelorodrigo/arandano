import { Prisma } from '@/generated/prisma/client'
import type { prismaParaTenant } from '@/lib/tenant/prisma'

export type TotalesDelMes = {
  cobrado: Prisma.Decimal
  costo: Prisma.Decimal
  ganancia: Prisma.Decimal
  sinDatos: number
}

/**
 * La fila de totales de "Entregado" de un mes: las entregadas, no anuladas,
 * cuya última entrega cae en `[desde, hasta)`.
 *
 * Cobrado y costo suman lo que haya —son plata que entró y plata que salió,
 * aunque la otra mitad falte—, pero la ganancia sale SÓLO de las órdenes que
 * tienen los dos: restar un costo sin cargar como si fuera 0 inventaría
 * ganancia (mismo criterio que `ganancia()` en plata.ts). Por eso la
 * ganancia no es `cobrado − costo` de esta misma fila, y `sinDatos` cuenta
 * las que quedaron afuera para que la diferencia no parezca un error.
 */
export async function totalesDelMes(
  prisma: ReturnType<typeof prismaParaTenant>,
  rango: { desde: Date; hasta: Date },
): Promise<TotalesDelMes> {
  const donde: Prisma.OrdenDeTrabajoWhereInput = {
    estado: 'ENTREGADO',
    anuladaEn: null,
    entregadaEn: { gte: rango.desde, lt: rango.hasta },
  }
  const [todas, completas] = await Promise.all([
    prisma.ordenDeTrabajo.aggregate({
      where: donde,
      _sum: { montoCobrado: true, costo: true },
      _count: { _all: true },
    }),
    prisma.ordenDeTrabajo.aggregate({
      where: { ...donde, montoCobrado: { not: null }, costo: { not: null } },
      _sum: { montoCobrado: true, costo: true },
      _count: { _all: true },
    }),
  ])
  // `_sum` de un conjunto vacío es null, no 0.
  const cero = new Prisma.Decimal(0)
  return {
    cobrado: todas._sum.montoCobrado ?? cero,
    costo: todas._sum.costo ?? cero,
    ganancia: (completas._sum.montoCobrado ?? cero).minus(completas._sum.costo ?? cero),
    sinDatos: todas._count._all - completas._count._all,
  }
}
