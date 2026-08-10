import { headers } from 'next/headers'

/**
 * El `baseURL` que Better Auth necesita, derivado del subdominio YA RESUELTO
 * (nunca del Host crudo del request) más el puerto de la CONFIGURACIÓN
 * (nunca del Host crudo tampoco).
 *
 * Son la misma decisión mirada desde dos lados, y por eso el porqué se
 * explica junto:
 *
 * El brief original armaba esto con `host = h.get('host')` completo. No se
 * implementa así: `subdominioDeHost` (lib/tenant/subdominio.ts) descarta el
 * puerto para resolver el tenant — `host.split(':')[0]` —, así que
 * `flor.arandano.app:9999` resuelve perfecto al tenant `flor`. Pero el Host
 * CRUDO conserva ese puerto, y `authParaTenant` (lib/auth/para-tenant.ts) usa
 * el origen completo como parte de la clave de caché (`${tenantId}|${origen}`).
 * Armar el origen (subdominio O puerto) desde el Host crudo dejaría que
 * cualquiera pida el mismo tenant con miles de puertos distintos en el Host,
 * generando miles de claves de caché que desalojan las instancias de OTROS
 * tenants — y desalojar una instancia reinicia su contador de rate limit de
 * `/sign-in/email` a cero (ver el comentario de TOPE en para-tenant.ts): el
 * único freno contra fuerza bruta que tiene el sistema. Un atacante le
 * reiniciaría el freno a un tercero pidiendo el subdominio ajeno con un
 * puerto inventado.
 *
 * `trustedOrigins` no sirve de salida para el puerto: en dev el origen es
 * distinto por tenant (`canario.dev.arandano.app:3000`,
 * `otro.dev.arandano.app:3000`, ...), así que una lista estática no alcanza
 * y una lista con comodines apuesta a que la versión instalada de Better
 * Auth los soporte.
 *
 * La salida real es que el puerto sea dato de la CONFIGURACIÓN del stack
 * (`PUERTO_PUBLICO`), no del request: en producción el sitio se sirve en
 * 443, implícito en `https://`, así que la variable queda sin definir y ni
 * el `Origin` del navegador ni el canónico llevan puerto. En dev vale
 * `3000`, así que el `baseURL` pasa a coincidir exacto con lo que manda el
 * navegador — sin volver a leer el Host, que es justo el camino que abre el
 * ataque de arriba.
 *
 * El protocolo es la tercera pieza de la misma familia de ataque, y por eso
 * tampoco se toma crudo: sale de una lista blanca de dos valores en vez de
 * `x-forwarded-proto` directo (detalle en el comentario de más abajo, junto
 * a donde se arma).
 *
 * Con las tres piezas armadas así —subdominio resuelto, puerto de
 * configuración, protocolo por lista blanca—, el conjunto de orígenes
 * posibles por tenant queda en dos (http y https), no infinito, y esa
 * propiedad vale en TODOS los entornos, no sólo en producción detrás de
 * Caddy.
 */
export async function origenDelRequest(subdominio: string): Promise<string> {
  const dominioBase = process.env.DOMINIO_BASE
  if (!dominioBase) {
    throw new Error(
      'DOMINIO_BASE no está definida: sin ella no se puede armar el baseURL de Better Auth.',
    )
  }

  // El protocolo sí sale del request, pero por lista blanca y no por el
  // valor crudo: quien alcanza la app sin pasar por Caddy —en dev, directo
  // por la IP de Tailscale, sin proxy delante— puede mandar
  // x-forwarded-proto con cualquier valor. Sin la lista blanca, cada valor
  // inventado arma un origen distinto y una clave de caché nueva en
  // authParaTenant: el mismo ataque que el puerto (ver el comentario de
  // arriba), mudado al protocolo. En producción Caddy es el único camino de
  // entrada y siempre lo reescribe a algo válido, así que esto no le cambia
  // nada — la lista blanca sólo cierra el camino que dev deja abierto.
  //
  // No se toma el primer valor de una lista separada por comas
  // (`x-forwarded-proto: https, http`, el formato de una cadena de más de un
  // proxy): hoy hay un solo proxy en el camino, así que ese caso no existe
  // todavía, y agregar código para manejarlo sería resolver un problema que
  // no hay.
  const crudo = (await headers()).get('x-forwarded-proto')
  const protocolo = crudo === 'https' ? 'https' : 'http'

  const puertoPublico = process.env.PUERTO_PUBLICO
  const puerto = puertoPublico ? `:${puertoPublico}` : ''

  return `${protocolo}://${subdominio}.${dominioBase}${puerto}`
}
