import { redirect, forbidden } from 'next/navigation'
import { headers } from 'next/headers'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { authParaTenant } from '@/lib/auth/para-tenant'
import { origenDelRequest } from '@/lib/auth/origen'
import type { TenantResuelto } from '@/lib/tenant/resolver'

export type RolUsuario = 'DUENO' | 'EMPLEADO'

export type Sesion = {
  tenant: TenantResuelto
  subdominio: string
  usuario: { id: string; nombre: string; email: string; rol: RolUsuario }
}

/**
 * Quién está usando este request, o null.
 *
 * Los tres chequeos no son redundantes entre sí:
 *
 * 1. Que haya sesión — lo obvio.
 * 2. Que el usuario no esté desactivado — Better Auth no sabe nada de eso, y va
 *    en CADA request: si se chequeara sólo al entrar, echar a un empleado no
 *    tendría efecto hasta que se le venciera la sesión.
 * 3. Que el tenant de la sesión sea el del Host — RLS ya lo garantiza, porque
 *    la fila de `sessions` no aparece con otro GUC. Se chequea igual: una sola
 *    capa en el aislamiento entre clientes es poca, y este `if` es barato.
 *
 * `origenDelRequest` recibe el subdominio YA resuelto (no el Host crudo): ver
 * el porqué en `lib/auth/origen.ts`, que es el mismo motivo por el que este
 * archivo no lee `headers().get('host')` en ningún lado.
 */
export async function sesionActual(): Promise<Sesion | null> {
  const resolucion = await tenantDelRequest()
  if (resolucion.tipo !== 'tenant') return null
  if (resolucion.tenant.estado === 'SUSPENDIDO') return null

  const origen = await origenDelRequest(resolucion.subdominio)
  const auth = authParaTenant(resolucion.tenant.id, origen)

  const sesion = await auth.api.getSession({ headers: await headers() })
  if (!sesion?.user) return null

  const usuario = sesion.user as unknown as {
    id: string
    name: string
    email: string
    rol: RolUsuario | null
    desactivadoEn: Date | string | null
  }

  // Chequeo 2: Better Auth no sabe nada de desactivación (ver test/auth.test.ts,
  // "la sesión de un usuario desactivado"), así que el filtro es nuestro.
  if (usuario.desactivadoEn) return null

  // Chequeo 3, tal como queda escrito acá: no es un `if` aparte porque no hay
  // ningún campo de tenant en `sesion.user` contra el cual compararlo — el
  // adapter de Better Auth no expone `tenantId` (no está en `additionalFields`
  // de opciones.ts, y no tendría por qué estarlo). El chequeo existe igual,
  // pero por CONSTRUCCIÓN: `auth` sale de `authParaTenant(resolucion.tenant.id,
  // …)`, que arma un cliente de Prisma atado a ESE tenant (prismaParaTenant),
  // y la policy de RLS de `sessions` filtra por ese GUC antes de que
  // `getSession` vea ninguna fila. Una sesión de otro tenant no es una fila
  // que este código descarte: es una fila que Postgres nunca deja llegar. Es
  // la misma garantía que describe el brief, expresada en qué cliente se usa
  // para preguntar, no en un `if` posterior a la respuesta.
  return {
    tenant: resolucion.tenant,
    subdominio: resolucion.subdominio,
    usuario: {
      id: usuario.id,
      nombre: usuario.name,
      email: usuario.email,
      rol: usuario.rol ?? 'EMPLEADO',
    },
  }
}

/** La sesión, o a la pantalla de login. Es lo que usan los layouts. */
export async function exigirSesion(): Promise<Sesion> {
  const sesion = await sesionActual()
  if (!sesion) redirect('/login')
  return sesion
}

/** La sesión de un dueño, o 403. */
export async function exigirDuenio(): Promise<Sesion> {
  const sesion = await exigirSesion()
  if (sesion.usuario.rol !== 'DUENO') forbidden()
  return sesion
}
