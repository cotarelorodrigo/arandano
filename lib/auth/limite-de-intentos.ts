import { getIp } from 'better-auth/api'
import { OPCIONES_BASE } from './opciones'

/**
 * El freno contra la fuerza bruta del login, en el camino que la pantalla usa
 * de verdad.
 *
 * `OPCIONES_BASE.rateLimit` existe desde el primer día y el spec lo llama "el
 * único freno contra la fuerza bruta", pero el limitador de Better Auth corre
 * en el `onRequest` de su ROUTER, y la pantalla no entra por ahí: entra por la
 * server action `entrar`, que llama a `auth.api.signInEmail` directo. Medido
 * por la review final: 12 intentos seguidos por la action, 12 respuestas de
 * credencial inválida y ningún 429. O sea que la regla protegía una puerta que
 * el producto no usa, y la rama del 429 en la action era código muerto.
 *
 * La puerta HTTP sigue existiendo (`/sign-in/email` NO está en
 * `RUTAS_HTTP_DESHABILITADAS`: es el endpoint que un cliente futuro usaría), y
 * la sigue cubriendo el limitador de la librería. Que haya dos contadores no es
 * duplicación: son dos puertas, y las dos necesitan freno. Los números salen de
 * un solo lugar —la misma regla `/sign-in/email` de `OPCIONES_BASE`— para que
 * no se puedan desincronizar.
 *
 * Por qué no se reusó el limitador de la librería: `onRequestRateLimit` no está
 * en la superficie pública del paquete (`better-auth/api` no lo re-exporta),
 * así que llamarlo significaría importar por una ruta interna que el campo
 * `exports` del package.json ni siquiera resuelve.
 *
 * **Cuenta fallas, no intentos.** El limitador de la librería cuenta requests;
 * acá se cuentan sólo los logins que fallaron. La diferencia importa en este
 * producto: los empleados de un local salen todos por la misma IP pública, así
 * que contar intentos exitosos le pondría un techo de 5 logins por minuto a un
 * comercio entero en un cambio de turno. Para el atacante el techo es el mismo
 * —5 adivinanzas por minuto—, que es lo único que este freno tiene que lograr.
 *
 * **En memoria, igual que el de la librería**, y por el mismo motivo: llevarlo
 * a la base agregaría una tabla sin `tenant_id` que `test/rls-cobertura.test.ts`
 * rechazaría con razón. Alcanza mientras haya una sola instancia de la
 * aplicación, y hoy la hay.
 */
export const REGLA_LOGIN = OPCIONES_BASE.rateLimit.customRules['/sign-in/email']

/** Cuando el request no trae una IP confiable, todo el local comparte bucket.
 *  Detrás de Caddy no pasa —el proxy escribe `X-Forwarded-For`—, y si algún día
 *  pasara, el modo de falla es un login más restrictivo, no uno más abierto. */
const SIN_IP = 'sin-ip'

type Ventana = { fallidos: number; venceEn: number }

const ventanas = new Map<string, Ventana>()

/**
 * Cada entrada se muere sola a los `window` segundos, así que el Map no crece
 * de forma ilimitada por el paso del tiempo — pero sí por cantidad de claves
 * distintas: un atacante que rota IPs deja una entrada por IP hasta que vence.
 * Podar cuando el tamaño se pasa de acá acota eso sin recorrer el Map en cada
 * intento.
 */
const TOPE_ANTES_DE_PODAR = 5_000

function podar(ahora: number): void {
  for (const [clave, ventana] of ventanas) {
    if (ventana.venceEn <= ahora) ventanas.delete(clave)
  }
}

/**
 * La clave del bucket: el local Y la IP.
 *
 * El tenant entra en la clave porque el rate limit de un local no puede ser
 * munición contra otro: sin él, un atacante contra `flor.arandano.app` dejaría
 * sin login a los empleados de `otro.arandano.app` que salgan por la misma IP.
 *
 * La IP se resuelve con el `getIp` de la propia librería —el mismo que usa su
 * limitador— para no inventar una segunda interpretación de `X-Forwarded-For`
 * (cadenas de proxies, IPv6, direcciones mapeadas) al lado de la que ya existe.
 */
export function claveDeIntento(tenantId: string, cabeceras: Headers): string {
  return `${tenantId}|${getIp(cabeceras, OPCIONES_BASE) ?? SIN_IP}`
}

/** Si ya se quemaron los intentos de esta ventana. Se consulta ANTES de llamar
 *  a Better Auth: cada intento cuesta un hash de scrypt, y en una máquina donde
 *  producción está capada cerca de un core, un atacante sin freno no es sólo un
 *  riesgo de credenciales — es el punto de venta caído. */
export function loginBloqueado(clave: string, ahora: number = Date.now()): boolean {
  const ventana = ventanas.get(clave)
  if (!ventana) return false
  if (ventana.venceEn <= ahora) {
    ventanas.delete(clave)
    return false
  }
  return ventana.fallidos >= REGLA_LOGIN.max
}

/** Suma una falla a la ventana en curso, o abre una nueva. */
export function registrarLoginFallido(clave: string, ahora: number = Date.now()): void {
  if (ventanas.size > TOPE_ANTES_DE_PODAR) podar(ahora)

  const ventana = ventanas.get(clave)
  if (!ventana || ventana.venceEn <= ahora) {
    ventanas.set(clave, { fallidos: 1, venceEn: ahora + REGLA_LOGIN.window * 1000 })
    return
  }
  ventana.fallidos += 1
}
