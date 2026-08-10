import { headers } from 'next/headers'

/**
 * El `baseURL` que Better Auth necesita, derivado del subdominio YA RESUELTO
 * (nunca del Host crudo del request).
 *
 * El brief original armaba esto con `host = h.get('host')` completo. No se
 * implementa así: `subdominioDeHost` (lib/tenant/subdominio.ts) descarta el
 * puerto para resolver el tenant — `host.split(':')[0]` —, así que
 * `flor.arandano.app:9999` resuelve perfecto al tenant `flor`. Pero el Host
 * CRUDO conserva ese puerto, y `authParaTenant` (lib/auth/para-tenant.ts) usa
 * el origen completo como parte de la clave de caché (`${tenantId}|${origen}`).
 * Armar el origen desde el Host crudo dejaría que cualquiera pida el mismo
 * tenant con miles de puertos distintos en el Host, generando miles de claves
 * de caché que desalojan las instancias de OTROS tenants — y desalojar una
 * instancia reinicia su contador de rate limit de `/sign-in/email` a cero
 * (ver el comentario de TOPE en para-tenant.ts): el único freno contra fuerza
 * bruta que tiene el sistema. Un atacante le reiniciaría el freno a un
 * tercero pidiendo el subdominio ajeno con un puerto inventado.
 *
 * Por eso esta función ni siquiera lee el header Host: recibe el subdominio
 * ya resuelto por `tenantDelRequest` y arma el origen contra DOMINIO_BASE, sin
 * puerto. El conjunto de orígenes posibles por tenant queda en dos (http y
 * https), no infinito.
 */
export async function origenDelRequest(subdominio: string): Promise<string> {
  const dominioBase = process.env.DOMINIO_BASE
  if (!dominioBase) {
    throw new Error(
      'DOMINIO_BASE no está definida: sin ella no se puede armar el baseURL de Better Auth.',
    )
  }

  // El protocolo sí sale del request: en producción lo pone Caddy al hacer
  // proxy por HTTPS. `host` nunca se lee acá — ver el porqué arriba.
  const protocolo = (await headers()).get('x-forwarded-proto') ?? 'http'
  return `${protocolo}://${subdominio}.${dominioBase}`
}
