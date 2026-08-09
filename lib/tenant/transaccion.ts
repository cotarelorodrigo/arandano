import { prisma } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'

/**
 * El cliente que ve el callback. Es transaccional y **no lleva la extensión**
 * de `prismaParaTenant`, así que cada `create` tiene que pasar `tenantId`
 * explícito. Lo atrapa el compilador —el campo es obligatorio— y detrás está el
 * WITH CHECK de la policy.
 */
export type ClienteTx = Prisma.TransactionClient

// Generoso para el trabajo del motor (una venta son ~10 sentencias) y finito
// igual: una transacción colgada retiene una de las 5 conexiones del pool, así
// que "sin límite" sería una forma de quedarse sin base para todos los tenants.
const TIMEOUT_MS = 10_000

// Cuánto espera por una conexión libre antes de rendirse. Por debajo del
// timeout de arriba a propósito: si el pool está saturado conviene fallar
// rápido y devolver el error, no hacer cola detrás de una transacción larga.
const MAX_WAIT_MS = 5_000

/**
 * Corre `fn` dentro de una transacción atada a `tenantId`.
 *
 * Existe porque `prismaParaTenant(...).$transaction(fn)` está bloqueado a
 * propósito: las operaciones del cliente extendido pasan por `$allOperations`,
 * que las agrupa en SU PROPIO `$transaction([...])` sobre el cliente base —otra
 * conexión— y la atomicidad se pierde en silencio. Acá la transacción se abre
 * sobre el cliente base y el `set_config` corre UNA vez adentro, así que todo
 * lo del callback comparte conexión, transacción y tenant.
 *
 * El tercer argumento `true` del `set_config` lo hace **local a la
 * transacción**: muere con ella. Es lo que impide que una conexión devuelta al
 * pool arrastre el tenant anterior hasta el request siguiente.
 *
 * No llamar a la red desde adentro: mientras dure, esta transacción retiene una
 * de las 5 conexiones del pool.
 */
export async function enTransaccionDeTenant<T>(
  tenantId: string,
  fn: (tx: ClienteTx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('arandano.tenant_id', ${tenantId}, true)`
      return fn(tx)
    },
    { timeout: TIMEOUT_MS, maxWait: MAX_WAIT_MS },
  )
}
