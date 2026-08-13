import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Los dos limitadores por IP —`lib/leads/limite.ts` y
 * `lib/auth/limite-de-intentos.ts`— resuelven la IP con el `getIp` de Better
 * Auth, y ése sólo sabe leer un `X-Forwarded-For` de **un solo hop**: sin
 * `trustedProxies` configurados, `getIPFromHeader` considera irresoluble toda
 * cadena más larga y devuelve `null`, lo que manda la request al bucket
 * compartido `sin-ip`.
 *
 * Que eso alcance depende de algo que no está en el código de la app: que Caddy
 * REEMPLACE el header en vez de appendearlo. Y lo hace — medido el 2026-08-13
 * contra Caddy 2.11.4, con un eco detrás del proxy en la misma red:
 *
 *   directo al eco, con `X-Forwarded-For: 1.2.3.4`  -> el eco recibe 1.2.3.4
 *   a través de Caddy, con el mismo header          -> el eco recibe 172.21.0.4
 *
 * o sea la IP real del par, con lo que el cliente mandó descartado. Es el
 * comportamiento que Caddy tiene desde 2.7: si el par inmediato no figura en
 * `trusted_proxies`, su `X-Forwarded-For` no se cree y se pisa. (Agregar
 * `header_up X-Forwarded-For {remote_host}` a mano es redundante: el propio
 * `caddy validate` lo reporta como "Unnecessary header_up X-Forwarded-For".)
 *
 * **Lo que rompería el supuesto es declarar `trusted_proxies`.** Ahí Caddy
 * empieza a creerle al header entrante y a appendear, la cadena pasa a tener dos
 * entradas, y los dos limitadores se degradan en silencio a `sin-ip` — donde
 * cualquiera que mande un `X-Forwarded-For` inventado puede agotarle el cupo al
 * resto. No hay forma de notarlo desde afuera: la app no devuelve por ninguna
 * ruta la IP que resolvió.
 *
 * Por eso el test fija la ausencia y no la presencia de algo. El día que haya
 * una razón real para poner `trusted_proxies` —un CDN adelante, por ejemplo—,
 * este test es el que va a exigir que en el mismo commit se configure
 * `advanced.ipAddress.trustedProxies` en `lib/auth/opciones.ts`.
 *
 * Lo que NO cubre: que alguien ponga otro proxy delante de Caddy sin tocar este
 * archivo. Eso no se ve desde acá.
 */
const CADDYFILE = path.join(import.meta.dirname, '..', 'docker', 'Caddyfile')

describe('el Caddyfile', () => {
  const lineas = readFileSync(CADDYFILE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))

  it('tiene los reverse_proxy que este check supone', () => {
    // Sin esto, un archivo vacío —o uno que dejó de tener proxies— pasaría el
    // caso de abajo en verde, que es el peor verde posible.
    expect(lineas.filter((l) => l.startsWith('reverse_proxy')).length).toBe(2)
  })

  it('no declara trusted_proxies, de lo que dependen los dos limitadores por IP', () => {
    expect(lineas.filter((l) => l.includes('trusted_proxies'))).toEqual([])
  })
})
