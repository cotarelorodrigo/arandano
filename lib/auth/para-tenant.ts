import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { OPCIONES_BASE } from './opciones'

/**
 * `betterAuth` es genérico en sus opciones, y `ReturnType<typeof betterAuth>`
 * sin argumentos instancia ese genérico contra su default (`BetterAuthOptions`
 * sin acotar) — un tipo distinto, por varianza de posición de función, al que
 * produce una llamada con un objeto literal concreto como la de acá abajo. El
 * síntoma es tsc rechazando `cache.set(clave, auth)` con un error de
 * `baseURL: BaseURLConfig | undefined` no asignable a `string`, sin que el
 * código tenga ningún bug real. La salida es la de siempre para este patrón:
 * derivar el tipo de una función concreta con la MISMA forma literal, en vez
 * de la firma genérica de la librería.
 */
function construir(tenantId: string, origen: string) {
  return betterAuth({
    ...OPCIONES_BASE,
    baseURL: origen,
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(prismaParaTenant(tenantId), {
      provider: 'postgresql',
      transaction: false,
    }),
    // Escribe la cookie de sesión cuando el login se llama desde una server
    // action, que es de donde lo llama la pantalla. Sin esto, el login
    // respondería bien y el navegador se quedaría sin cookie: entrarías y
    // seguirías deslogueado. Va acá y no en OPCIONES_BASE para que ese módulo
    // siga siendo verificable sin Next. Tiene que ser el ÚLTIMO del array.
    plugins: [nextCookies()],
  })
}

type Auth = ReturnType<typeof construir>

/**
 * Tope de la memoización. Desalojar una instancia no es gratis como parece:
 * `OPCIONES_BASE` configura `rateLimit.storage: 'memory'` (ver opciones.ts,
 * "el único freno contra la fuerza bruta"), y ese contador vive DENTRO de la
 * instancia de Better Auth. Desalojar una instancia no sólo la reconstruye:
 * reinicia su contador de intentos de `/sign-in/email` a cero. Por eso el
 * desalojo de abajo es por USO y no por inserción — ver el reinsertado en
 * `authParaTenant` — y "los locales sin tráfico se caen solos" recién así es
 * cierto: con desalojo por inserción (FIFO), un local con tráfico continuo
 * insertado temprano se cae igual, por turno, y pierde su contador con él.
 */
const TOPE = 200

const cache = new Map<string, Auth>()

/**
 * La instancia de Better Auth de un tenant.
 *
 * El truco entero del ciclo está en el `database`: se le entrega un cliente de
 * Prisma que YA está atado al tenant, así que Better Auth nunca se entera de
 * que existe multi-tenancy. Su búsqueda por mail —la del login— y su búsqueda
 * por token —la de la sesión— quedan acotadas por las policies de RLS, en la
 * base. No hay ningún `if` nuestro en ese camino que alguien pueda olvidarse
 * de escribir.
 *
 * `transaction: false` es explícito y NO se deja al default de la librería a
 * propósito. `prismaParaTenant` rechaza `$transaction(fn)` —las operaciones del
 * callback se reagruparían en otra conexión y la atomicidad se perdería en
 * silencio—, así que si una versión futura cambiara ese default, el síntoma
 * sería el guard tirando error en el login. Ruidoso, pero en el peor momento.
 *
 * El `origen` entra en la clave del caché porque el mismo tenant puede
 * atenderse por http en dev y por https en producción, y el baseURL cambia.
 */
export function authParaTenant(tenantId: string, origen: string): Auth {
  const clave = `${tenantId}|${origen}`

  const guardada = cache.get(clave)
  if (guardada) {
    // Reinsertar mueve la clave al final del Map (que itera en orden de
    // inserción): un acierto de caché la saca de la cola de desalojo. Sin
    // este reinsertado el desalojo sería FIFO por alta, no por uso — ver el
    // comentario de TOPE.
    cache.delete(clave)
    cache.set(clave, guardada)
    return guardada
  }

  const auth = construir(tenantId, origen)

  // La más vieja por USO —gracias al reinsertado de arriba— es la primera
  // del iterador, así que sigue siendo válido tomarla como candidata al
  // desalojo.
  if (cache.size >= TOPE) {
    const masVieja = cache.keys().next().value
    if (masVieja !== undefined) cache.delete(masVieja)
  }
  cache.set(clave, auth)

  return auth
}
