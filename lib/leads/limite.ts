import { getIp } from 'better-auth/api'
import { OPCIONES_BASE } from '@/lib/auth/opciones'

/**
 * El freno del formulario de la landing.
 *
 * Es hermano de `lib/auth/limite-de-intentos.ts` y no el mismo: aquél cuenta
 * logins FALLIDOS por (tenant, IP), porque los empleados de un local salen
 * todos por la misma IP pública y contar los exitosos le pondría techo a un
 * cambio de turno. Acá no hay tenant —el ápex no es de nadie— y se cuentan los
 * envíos EXITOSOS, que es lo que un bot repite.
 *
 * La IP se resuelve con el `getIp` de Better Auth, el mismo que usa el otro
 * limitador, para no inventar una segunda lectura de `X-Forwarded-For`
 * (cadenas de proxies, IPv6, direcciones mapeadas) al lado de la que ya existe.
 *
 * **En memoria del proceso.** Se resetea en cada deploy y NO sirve si algún día
 * hay dos instancias de la aplicación — que es exactamente el escenario que
 * CLAUDE.md tiene anotado como "sumar Redis es una decisión consciente, no un
 * default". Queda escrito para que ese día esto aparezca como deuda conocida y
 * no como misterio.
 */
export const MAXIMO_POR_VENTANA = 5

const VENTANA_MS = 60 * 60 * 1000

/** Cuando el request no trae IP confiable, todos comparten bucket: el modo de
 *  falla es un formulario más restrictivo, nunca uno más abierto. */
const SIN_IP = 'sin-ip'

type Ventana = { envios: number; venceEn: number }

const ventanas = new Map<string, Ventana>()

/** Mismo recurso que el limitador del login: las entradas vencen solas, pero
 *  una rotación de IPs deja una por IP hasta que venza. Podar cuando el Map se
 *  pasa de acá lo acota sin recorrerlo en cada envío. */
const TOPE_ANTES_DE_PODAR = 5_000

function podar(ahora: number): void {
  for (const [clave, ventana] of ventanas) {
    if (ventana.venceEn <= ahora) ventanas.delete(clave)
  }
}

export function claveDeEnvio(cabeceras: Headers): string {
  return getIp(cabeceras, OPCIONES_BASE) ?? SIN_IP
}

export function envioBloqueado(clave: string, ahora: number = Date.now()): boolean {
  const ventana = ventanas.get(clave)
  if (!ventana) return false
  if (ventana.venceEn <= ahora) {
    ventanas.delete(clave)
    return false
  }
  return ventana.envios >= MAXIMO_POR_VENTANA
}

export function registrarEnvio(clave: string, ahora: number = Date.now()): void {
  if (ventanas.size > TOPE_ANTES_DE_PODAR) podar(ahora)

  const ventana = ventanas.get(clave)
  if (!ventana || ventana.venceEn <= ahora) {
    ventanas.set(clave, { envios: 1, venceEn: ahora + VENTANA_MS })
    return
  }
  ventana.envios += 1
}
