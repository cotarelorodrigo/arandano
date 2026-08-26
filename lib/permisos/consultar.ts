import { cache } from 'react'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import type { Permiso } from './catalogo'

/**
 * Los permisos de una persona, como Set.
 *
 * **Memoizada por request con `cache()` de React, y no cargada dentro de
 * `sesionActual()`.** Meterla en la sesión haría que toda pantalla pague esta
 * query, y `sesionActual()` corre en cada layout y en cada página; la mayoría
 * no pregunta nada. Con `cache()` la consulta ocurre a lo sumo una vez por
 * request, y sólo si alguien pregunta.
 *
 * **Nunca se llama para un DUENO**: la guarda corta antes. Ver `guarda.ts`.
 */
export const permisosDe = cache(
  async (tenantId: string, usuarioId: string): Promise<Set<Permiso>> => {
    const filas = await prismaParaTenant(tenantId).usuarioPermiso.findMany({
      where: { usuarioId },
      select: { permiso: true },
    })
    return new Set(filas.map((f) => f.permiso as Permiso))
  },
)
