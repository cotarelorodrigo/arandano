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

  const cabeceras = await headers()

  // `x-forwarded-host` ANTES que `host`, y no es una preferencia de estilo: es
  // la única forma de que un redirect de server action resuelva el tenant.
  //
  // Cuando una action llama a redirect(), Next no renderiza el destino en este
  // mismo request: hace un `fetch()` HTTP contra sí mismo
  // (`createRedirectRenderResult`, en su action-handler) hacia el origen con el
  // que arrancó el servidor, y devuelve ese render incrustado en la respuesta
  // de la action. Al ser un fetch de verdad, el `Host` que le llega a ese
  // render es el del destino —`localhost:3000`— y el hostname que pidió el
  // navegador viaja sólo en `x-forwarded-host`. Leyendo `host`, ese render daba
  // 'ajeno' y `app/page.tsx` contestaba notFound(): entrar al login dejaba la
  // URL en `/` mostrando el 404 de Next, y un F5 lo arreglaba porque un GET
  // normal sí trae el Host bueno.
  //
  // No amplía la superficie de suplantación. Detrás de Caddy el header lo
  // escribe el proxy: PISA el que mande el cliente (medido con la imagen de
  // producción, `arandano-caddy:2.11.4-hetzner`). Y donde no hay proxy —dev y
  // stage, sólo alcanzables por Tailscale— elegir tenant por `x-forwarded-host`
  // no da nada que no diera ya mandar el `Host`: pedir flor.arandano.app ES
  // elegir tenant, como dice el comentario de arriba. Lo que impide usar el
  // tenant ajeno sigue siendo que la sesión está atada a un tenant y que RLS
  // filtra por él.
  //
  // El fallback a `host` casi no corre: Next completa `x-forwarded-host` con el
  // `host` en cada request que entra. Está para no depender de ese detalle.
  const host = cabeceras.get('x-forwarded-host') ?? cabeceras.get('host')
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
