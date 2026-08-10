import { headers } from 'next/headers'
import { subdominioDeHost, SUBDOMINIOS_RESERVADOS } from './subdominio'
import { resolverTenant, type TenantResuelto } from './resolver'

export type ResolucionTenant =
  // El subdominio va acá y NO dentro de `tenant`: TenantResuelto declara ser
  // exactamente lo que devuelve la función de Postgres, y sumarle un campo que
  // no viene de ahí rompería esa garantía. Lo necesita el baseURL de Better Auth.
  | { tipo: 'tenant'; tenant: TenantResuelto; subdominio: string }
  | { tipo: 'apex' }
  | { tipo: 'ajeno' }
  | { tipo: 'reservado'; subdominio: string }
  | { tipo: 'inexistente'; subdominio: string }

/**
 * De qué tenant es este request.
 *
 * Acá vive la resolución y no en un `middleware.ts`, y el motivo está en el
 * spec: el middleware de Next no puede consultar Postgres, así que tendría que
 * pasarle el resultado a la aplicación por un header — y un header del que la
 * aplicación deduce qué tenant servir es una superficie de suplantación que no
 * compra nada, porque el dato del que sale (el Host) la aplicación ya lo lee
 * directo.
 *
 * Que el Host lo elija el cliente está bien: pedir flor.arandano.app ES elegir
 * tenant, igual que tipear la URL. El Host no es una credencial y nunca lo fue.
 * Lo que impide suplantar a otro tenant es que la sesión quede atada a un
 * tenant y se rechace todo request cuyo Host no coincida — eso es trabajo del
 * ciclo de autenticación, y todavía no existe.
 *
 * Leer headers() obliga a Next a renderizar dinámicamente, y eso es un
 * REQUISITO, no un efecto colateral: una página de tenant cacheada y servida a
 * otro tenant es una fuga de datos entre clientes.
 */
export async function tenantDelRequest(): Promise<ResolucionTenant> {
  const dominioBase = process.env.DOMINIO_BASE
  if (!dominioBase) {
    throw new Error(
      'DOMINIO_BASE no está definida: sin ella no se puede decidir qué parte ' +
        'del Host es el subdominio del tenant. Definirla en el compose del stack.',
    )
  }

  const host = (await headers()).get('host')
  const analizado = subdominioDeHost(host, dominioBase)
  if (analizado.tipo !== 'tenant') return analizado

  // Los reservados se cortan acá, antes de la base: si alguien insertara a mano
  // una fila con subdominio 'admin', igual no resolvería.
  if (SUBDOMINIOS_RESERVADOS.includes(analizado.subdominio)) {
    return { tipo: 'reservado', subdominio: analizado.subdominio }
  }

  const tenant = await resolverTenant(analizado.subdominio)
  if (!tenant) return { tipo: 'inexistente', subdominio: analizado.subdominio }

  return { tipo: 'tenant', tenant, subdominio: analizado.subdominio }
}
