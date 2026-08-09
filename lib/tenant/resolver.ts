import { pool } from '@/lib/db'

/**
 * Lo que devuelve `resolver_tenant`, ni un campo más.
 *
 * A propósito NO es el modelo `Tenant` de Prisma: tiparlo así afirmaría que se
 * leyeron columnas que la función no devuelve, y el primer acceso a una de
 * ellas daría `undefined` en lugar de un error de compilación.
 */
export type TenantResuelto = {
  id: string
  nombre: string
  estado: 'TRIAL' | 'ACTIVO' | 'SUSPENDIDO'
}

/**
 * La única consulta de la aplicación que corre deliberadamente FUERA de la
 * frontera de tenant.
 *
 * Va por `pool` y no por `prismaParaTenant()` porque no puede ir por ahí: ese
 * helper exige un tenantId, que es justo lo que esto está buscando. La
 * seguridad no la da el GUC acá, la da el ancho de la función — devuelve un
 * tenant por subdominio exacto y no permite enumerar.
 */
export async function resolverTenant(subdominio: string): Promise<TenantResuelto | null> {
  const { rows } = await pool.query(
    'SELECT id, nombre, estado FROM resolver_tenant($1)',
    [subdominio],
  )
  const fila = rows[0]
  if (!fila) return null
  return { id: fila.id, nombre: fila.nombre, estado: fila.estado }
}
