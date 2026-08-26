import { prismaParaTenant } from '@/lib/tenant/prisma'
import type { Permiso } from './catalogo'
import { ErrorDePermiso } from './errores'

type Args = { tenantId: string; usuarioId: string; permiso: Permiso }

/**
 * Comprueba que el destinatario exista, sea de ESTE tenant y sea empleado.
 *
 * Lo de "este tenant" no lo garantiza el `where`: lo garantiza RLS, porque
 * `prismaParaTenant` fija la GUC y la policy filtra antes. El `findUnique` de
 * un usuario ajeno devuelve null, y por eso el mismo chequeo cubre los dos
 * casos.
 */
async function empleadoDelTenant({ tenantId, usuarioId }: Omit<Args, 'permiso'>) {
  const usuario = await prismaParaTenant(tenantId).user.findUnique({
    where: { id: usuarioId },
    select: { rol: true },
  })
  if (!usuario) {
    throw new ErrorDePermiso('USUARIO_INEXISTENTE', 'Esa persona no está en este local.')
  }
  if (usuario.rol === 'DUENO') {
    throw new ErrorDePermiso('ES_DUENO', 'Un dueño ya puede hacer todo; no hay nada que ajustarle.')
  }
}

/**
 * Otorga un permiso. **Idempotente**: la pantalla lo dispara desde un switch, y
 * dos clicks rápidos mandan la misma orden dos veces — sin el `skipDuplicates`
 * el segundo chocaría contra la clave primaria y la persona vería un error por
 * haber conseguido justamente lo que pidió.
 *
 * `tenantId` explícito en el `data`: `MODELOS_CON_TENANT` (lib/tenant/prisma.ts)
 * no incluye este modelo, así que la extensión no lo autocompleta.
 */
export async function otorgar({ tenantId, usuarioId, permiso }: Args): Promise<void> {
  await empleadoDelTenant({ tenantId, usuarioId })
  await prismaParaTenant(tenantId).usuarioPermiso.createMany({
    data: [{ tenantId, usuarioId, permiso }],
    skipDuplicates: true,
  })
}

/**
 * Revoca un permiso. **Idempotente** por el mismo motivo: `deleteMany` borra
 * cero filas sin quejarse, mientras que `delete` tiraría P2025 al revocar algo
 * que no estaba.
 */
export async function revocar({ tenantId, usuarioId, permiso }: Args): Promise<void> {
  await empleadoDelTenant({ tenantId, usuarioId })
  await prismaParaTenant(tenantId).usuarioPermiso.deleteMany({
    where: { usuarioId, permiso },
  })
}
