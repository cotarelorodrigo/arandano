/**
 * Todo lo que se puede decidir sobre un subdominio sin tocar la base ni el
 * request. Está separado de `resolver.ts` a propósito: esto se testea con una
 * tabla de casos y aquello necesita Postgres. Mezclados, ninguno de los dos se
 * testea bien.
 */

/**
 * Subdominios que nunca resuelven a un tenant y que el alta rechaza.
 *
 * `dev` y `stage` no están por prolijidad: los dominios base de esos entornos
 * son `dev.arandano.app` y `stage.arandano.app`, así que un tenant llamado
 * `dev` en producción crea una colisión de nombres con un entorno interno.
 */
export const SUBDOMINIOS_RESERVADOS: readonly string[] = [
  'www', 'api', 'admin', 'app', 'static', 'assets', 'cdn',
  'mail', 'smtp', 'ftp', 'dev', 'stage', 'ensayo',
  'status', 'docs', 'blog', 'help', 'soporte',
]

/**
 * Tipo discriminado y no `string | null`: el apex y un dominio ajeno son los
 * dos "no hay subdominio", pero piden respuestas distintas — placeholder uno,
 * 404 el otro. Un `null` que representa dos situaciones obliga a quien llama a
 * re-derivar cuál es, y ahí es donde se cuela el caso que nadie manejó.
 */
export type HostAnalizado =
  | { tipo: 'tenant'; subdominio: string }
  | { tipo: 'apex' }
  | { tipo: 'ajeno' }

export function subdominioDeHost(
  host: string | null | undefined,
  dominioBase: string,
): HostAnalizado {
  if (!host) return { tipo: 'ajeno' }

  // El Host trae el puerto cuando no es 80/443, y en dev siempre lo trae.
  const limpio = host.trim().toLowerCase().split(':')[0]
  const base = dominioBase.trim().toLowerCase()
  if (!limpio || !base) return { tipo: 'ajeno' }

  if (limpio === base) return { tipo: 'apex' }

  // El punto va en la comparación y no después: sin él, `malarandano.app`
  // pasaría por subdominio de `arandano.app`.
  if (!limpio.endsWith('.' + base)) return { tipo: 'ajeno' }

  const prefijo = limpio.slice(0, limpio.length - base.length - 1)

  // Exactamente una etiqueta: ni más de una (`a.b.arandano.app`, que
  // aceptarlo significaría que dos hosts distintos resuelven al mismo
  // tenant, una superficie que no hace falta tener con cookies de sesión de
  // por medio) ni cero (`.arandano.app`, que sin este chequeo atravesaba las
  // dos condiciones de arriba y volvía subdominio: '').
  if (prefijo === '' || prefijo.includes('.')) return { tipo: 'ajeno' }

  return { tipo: 'tenant', subdominio: prefijo }
}

export type ResultadoValidacion = { ok: true } | { ok: false; motivo: string }

/** Reglas de formato del subdominio, aplicadas por el alta antes de tocar la base. */
export function validarSubdominio(subdominio: string): ResultadoValidacion {
  if (subdominio !== subdominio.trim().toLowerCase()) {
    return { ok: false, motivo: 'tiene que estar en minúsculas y sin espacios alrededor' }
  }
  if (subdominio.length < 3 || subdominio.length > 63) {
    return { ok: false, motivo: 'tiene que tener entre 3 y 63 caracteres' }
  }
  if (!/^[a-z0-9-]+$/.test(subdominio)) {
    return { ok: false, motivo: 'sólo puede tener letras minúsculas, números y guiones' }
  }
  if (subdominio.startsWith('-') || subdominio.endsWith('-')) {
    return { ok: false, motivo: 'no puede empezar ni terminar con guión' }
  }
  if (SUBDOMINIOS_RESERVADOS.includes(subdominio)) {
    return { ok: false, motivo: `"${subdominio}" está reservado para uso interno` }
  }
  return { ok: true }
}
