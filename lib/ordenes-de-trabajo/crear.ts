import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { exigirCliente, exigirUsuario } from '@/lib/ventas/pertenencia'
import { crearClienteEn } from '@/lib/clientes/administrar'
import { ErrorDeOrden } from './errores'

export type EntradaCrearOrden = {
  tenantId: string
  usuarioId: string
  // Uno de los dos, y el cliente es obligatorio al revés que en una venta: el
  // punto de una orden es saber a quién llamar cuando el equipo está listo.
  // `clienteId` para el que ya está cargado (y para el sembrador);
  // `clienteNuevo` para el alta al vuelo del mostrador.
  clienteId?: string
  clienteNuevo?: { nombre: string; telefono: string | null }
  equipoMarca: string
  equipoModelo: string
  equipoSerie?: string | null
  claveDesbloqueo?: string | null
  fallaDeclarada: string
  accesorios?: string | null
  danosVisibles?: string | null
  // Opcional: el motor no la inventa. La pantalla sí la manda. Mismo criterio
  // que crearVenta.
  claveIdempotencia?: string
}

const limpio = (v: string | null | undefined): string | null => v?.trim() || null

export async function crearOrden(
  entrada: EntradaCrearOrden,
): Promise<{ id: string; numero: number }> {
  const { tenantId, usuarioId, claveIdempotencia } = entrada

  if (!entrada.clienteId && !entrada.clienteNuevo) {
    throw new ErrorDeOrden('SIN_CLIENTE', 'la orden necesita un cliente')
  }

  const equipoMarca = entrada.equipoMarca.trim()
  const equipoModelo = entrada.equipoModelo.trim()
  const fallaDeclarada = entrada.fallaDeclarada.trim()

  if (equipoMarca === '') throw new ErrorDeOrden('MARCA_VACIA', 'falta la marca del equipo')
  if (equipoModelo === '') throw new ErrorDeOrden('MODELO_VACIO', 'falta el modelo del equipo')
  if (fallaDeclarada === '') {
    throw new ErrorDeOrden('FALLA_VACIA', 'hay que anotar qué dijo el cliente que le pasa')
  }

  try {
    return await enTransaccionDeTenant(tenantId, async (tx) => {
      // ANTES de tomar el correlativo: si esta clave ya dio de alta una orden,
      // no hay nada que hacer más que devolver la que se creó la primera vez.
      // Es el camino rápido del caso común (el doble click con medio segundo de
      // diferencia); el índice único es el que cierra la carrera exacta.
      if (claveIdempotencia !== undefined) {
        const yaExiste = await tx.ordenDeTrabajo.findFirst({
          where: { claveIdempotencia },
          select: { id: true, numero: true },
        })
        if (yaExiste) return yaExiste
      }

      // El cliente nuevo nace ACÁ ADENTRO, y DESPUÉS del camino rápido de la
      // idempotencia. Las dos cosas importan y por el mismo argumento que el
      // spec usa para la orden y su primer evento: lo que tiene que pasar junto
      // va en una sola transacción.
      //
      // Comiteado aparte —como estaba— cualquier falla posterior dejaba un
      // Cliente huérfano, y el reintento creaba otro porque el formulario
      // seguía diciendo "cliente nuevo". Peor: en el escenario exacto que la
      // clave de idempotencia existe para cubrir (doble click, F5 sobre el
      // POST, reintento de red) el segundo submit creaba un SEGUNDO "Juan
      // Pérez" y recién después devolvía la orden que ya existía. Un equipo,
      // una orden, y dos clientes que nadie puede fusionar porque /clientes
      // todavía no existe.
      let clienteId = entrada.clienteId
      if (clienteId === undefined) {
        const nuevo = entrada.clienteNuevo
        // El guard de arriba ya lo garantiza; TypeScript no puede saberlo.
        if (nuevo === undefined) {
          throw new ErrorDeOrden('SIN_CLIENTE', 'la orden necesita un cliente')
        }
        clienteId = (await crearClienteEn(tx, { tenantId, ...nuevo })).id
      } else {
        // Las FKs de Postgres no distinguen tenants. El porqué completo está en
        // lib/ventas/pertenencia.ts. Sólo para el cliente que vino elegido: el
        // que se acaba de crear recién nació con este tenantId.
        //
        // Y a propósito SIN el esUuid() que sí guarda a `ordenId` en
        // operaciones.ts: con una sesión válida este id sale de un desplegable
        // que armó el servidor, así que un `clienteId` deforme es un POST
        // armado a mano, o sea un bug — y lib/ordenes-de-trabajo/errores.ts ya
        // decide que eso llegue como 500 a Sentry. Guardarlo cambiaría un 500
        // por otro más silencioso y taparía justo lo que hay que ver. En
        // `ordenId` el guard sí corresponde porque ahí existe el error de
        // dominio correcto (ORDEN_INEXISTENTE) y es lo que hay que mostrar.
        await exigirCliente(tx, clienteId)
      }
      await exigirUsuario(tx, usuarioId)

      // Lo más tarde posible: toma el lock de la fila del tenant y lo retiene
      // hasta el commit, o sea que serializa las altas de ese negocio.
      const numero = await proximoNumero(tx, tenantId)

      const orden = await tx.ordenDeTrabajo.create({
        data: {
          tenantId,
          numero,
          claveIdempotencia,
          clienteId,
          recibidaPorId: usuarioId,
          estado: 'RECIBIDO',
          equipoMarca,
          equipoModelo,
          equipoSerie: limpio(entrada.equipoSerie),
          claveDesbloqueo: limpio(entrada.claveDesbloqueo),
          fallaDeclarada,
          accesorios: limpio(entrada.accesorios),
          danosVisibles: limpio(entrada.danosVisibles),
          // El evento de apertura, en la MISMA transacción: una orden sin su
          // primera línea de bitácora es una historia que arranca por la mitad.
          eventos: {
            create: [{ tenantId, desde: null, hasta: 'RECIBIDO', usuarioId }],
          },
        },
        select: { id: true, numero: true },
      })

      return orden
    })
  } catch (e) {
    // El choque de la clave no es una falla: es la respuesta correcta llegando
    // dos veces. ACÁ AFUERA y no adentro del callback, porque una violación de
    // unicidad ABORTA la transacción en Postgres y cualquier consulta posterior
    // sobre esa conexión falla con "current transaction is aborted".
    if (claveIdempotencia !== undefined && esP2002(e)) {
      const yaExiste = await enTransaccionDeTenant(tenantId, async (tx) =>
        tx.ordenDeTrabajo.findFirst({
          where: { claveIdempotencia },
          select: { id: true, numero: true },
        }),
      )
      // Si aparece, el choque era éste. Si no, era el correlativo y relanzar es
      // lo correcto: devolver algo ahí sería inventar.
      if (yaExiste) return yaExiste
    }
    throw e
  }
}

/**
 * No mira QUÉ unicidad chocó, y no es pereza: bajo `arandano_app` Postgres
 * retiene el detalle del error porque la policy de RLS aplica al rol que
 * consulta, así que `constraint.fields` no está disponible. Quién chocó se
 * decide después, buscando la clave.
 */
function esP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/**
 * El correlativo por tenant, incrementado dentro de la transacción.
 *
 * Un `UPDATE … RETURNING` y no un `count()`: contar órdenes daría el mismo
 * número a dos altas concurrentes. Esto las serializa —toma el lock de la fila
 * del tenant— y a cambio no hay huecos ni repetidos, que es lo que hace que
 * "la orden 42" sirva para hablar por teléfono.
 */
async function proximoNumero(tx: ClienteTx, tenantId: string): Promise<number> {
  const filas = await tx.$queryRaw<{ proximo_numero_orden: number }[]>`
    UPDATE tenants
       SET proximo_numero_orden = proximo_numero_orden + 1
     WHERE id = ${tenantId}::uuid
    RETURNING proximo_numero_orden - 1 AS proximo_numero_orden
  `
  // Cero filas: el tenant no existe, o existe y RLS no lo deja ver — que para
  // el motor es lo mismo. Sin este guard el llamador recibe un TypeError en vez
  // de un ErrorDeOrden, justo en la única línea que habla SQL crudo.
  if (filas.length === 0) {
    throw new ErrorDeOrden('TENANT_INEXISTENTE', `el tenant ${tenantId} no existe`)
  }
  return filas[0].proximo_numero_orden
}
