import { prisma } from '@/lib/db'

/** Modelos que llevan tenant_id y por lo tanto se les puede autocompletar. */
const MODELOS_CON_TENANT = new Set(['User', 'Cliente', 'Articulo', 'TenantModule'])

/** Operaciones que escriben filas nuevas. */
const OPERACIONES_DE_ALTA = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert'])

type Args = Record<string, unknown>

function conTenant(dato: unknown, tenantId: string): unknown {
  if (Array.isArray(dato)) return dato.map((d) => conTenant(d, tenantId))
  if (dato && typeof dato === 'object') return { tenantId, ...(dato as object) }
  return dato
}

function completarAlta(operacion: string, args: Args, tenantId: string): Args {
  if (operacion === 'upsert') {
    return { ...args, create: conTenant(args.create, tenantId) }
  }
  return { ...args, data: conTenant(args.data, tenantId) }
}

/**
 * Cliente de Prisma atado a un tenant.
 *
 * Cada operación va en SU PROPIA transacción, y lo primero que corre adentro es
 * el set_config con el tercer argumento en true: eso la hace local a la
 * transacción, así que muere con ella. Ese es el argumento de seguridad
 * completo — una conexión devuelta al pool y reusada por otro request no puede
 * arrastrar el tenant anterior.
 *
 * Una transacción por operación y no una por request: el pool es de 5
 * conexiones, y sostener una transacción mientras dura el request deja al sexto
 * request concurrente esperando. El costo es un ida y vuelta extra por query.
 *
 * La extensión NO inyecta `where` en las lecturas: de eso se encarga la policy,
 * que falla cerrado. Un `where` duplicado no agregaría defensa, agregaría una
 * segunda cosa que se puede desactualizar respecto de la primera.
 */
export function prismaParaTenant(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const argsFinales =
            MODELOS_CON_TENANT.has(model) && OPERACIONES_DE_ALTA.has(operation)
              ? completarAlta(operation, args as Args, tenantId)
              : args

          const [, resultado] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('arandano.tenant_id', ${tenantId}, true)`,
            query(argsFinales),
          ])
          return resultado
        },
      },
    },
  })
}
