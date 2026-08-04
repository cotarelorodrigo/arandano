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
 * Mensaje del guard de `$transaction(fn)` — ver el comentario debajo del JSDoc
 * principal para el porqué.
 */
const MENSAJE_TRANSACCION_INTERACTIVA =
  'prismaParaTenant(tenantId).$transaction(fn) todavía no está soportado. Las ' +
  'operaciones que corren adentro del callback pasan igual por $allOperations, ' +
  'que las agrupa en SU PROPIO $transaction([...]) sobre el cliente BASE — una ' +
  'conexión distinta a la de esta transacción interactiva. La atomicidad se ' +
  'pierde en silencio (sin este guard, ni siquiera tira error) y, con las 5 ' +
  'conexiones del pool tomadas por transacciones interactivas en vuelo, el ' +
  'batch que se escapa se cuelga hasta connectionTimeoutMillis (1500ms) y falla. ' +
  'Para trabajo atómico multi-paso (p. ej. crearVentaDesde: venta + movimiento ' +
  'de stock) hace falta un helper dedicado que abra la transacción interactiva ' +
  'y corra el set_config una sola vez adentro — todavía no existe, es tarea aparte.'

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
 *
 * Cobertura: `query.$allModels` intercepta operaciones de MODELO (`create`,
 * `findMany`, etc.). NO intercepta `$queryRaw`/`$queryRawUnsafe`/`$executeRaw`
 * llamados directamente sobre el cliente devuelto acá — esas corren sin
 * `set_config`. No es un agujero porque la policy de RLS falla cerrado (sin
 * `arandano.tenant_id` seteado, no hay filas), pero significa que un raw query
 * mal puesto no autocompleta ni filtra nada por sí solo: sigue dependiendo de
 * que la policy exista y esté bien escrita.
 *
 * `$transaction(fn)` interactivo NO está soportado todavía — ver el guard en
 * el componente `client` de abajo y `MENSAJE_TRANSACCION_INTERACTIVA`. Usar
 * `prisma.$transaction([...])` (forma en array) tampoco tiene sentido acá,
 * porque cada operación del cliente extendido ya ejecuta su propio batch al
 * invocarse.
 */
export function prismaParaTenant(tenantId: string) {
  return prisma.$extends({
    client: {
      // Guard que falla ruidosamente ante `$transaction(fn)`: ver el JSDoc de
      // prismaParaTenant. Sin este guard, el uso se "resuelve" en silencio con
      // una atomicidad falsa — el peor tipo de bug, porque no hay excepción
      // que lo delate hasta que dos escrituras que debían ser atómicas quedan
      // a mitad de camino.
      $transaction(...args: unknown[]) {
        if (typeof args[0] === 'function') {
          throw new Error(MENSAJE_TRANSACCION_INTERACTIVA)
        }
        return (prisma.$transaction as (...a: unknown[]) => unknown)(...args)
      },
    },
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
