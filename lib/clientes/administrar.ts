import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { limpiarCampos, type CamposLimpios } from './campos'
import { ErrorDeCliente } from './errores'
import { dondeBusca } from './filtros'
import { rotuloDeHistoria } from './rotulos'

export type EntradaCrearCliente = {
  tenantId: string
  nombre: string
  telefono: string | null
  // Opcionales para los llamadores de antes de la solapa Clientes —el alta al
  // vuelo de una orden de trabajo, el sembrador, los tests—, que sólo tienen
  // nombre y teléfono. Ausentes valen "sin dato" y "no acepta ofertas", que es
  // exactamente lo que esos clientes eran.
  email?: string | null
  notas?: string | null
  aceptaOfertas?: boolean
}

/**
 * Serializa las altas y ediciones que reclaman la misma clave de teléfono en el
 * mismo local, hasta el commit.
 *
 * Sin esto, dos altas simultáneas del mismo número —el mostrador cobrando y el
 * técnico recibiendo un equipo de la misma persona— miran la tabla, ninguna ve
 * a la otra porque ninguna comiteó, y las dos escriben. Un `FOR UPDATE` no
 * alcanza: no hay ninguna fila con esa clave que bloquear, que es justo el caso
 * del primer alta. Es el mismo argumento, y el mismo mecanismo, que los rangos
 * del plan canje (`bloquearRangos`, lib/canje/administrar.ts):
 * `pg_advisory_xact_lock` se suelta solo al terminar la transacción.
 *
 * La clave del lock lleva el tenant Y la clave del teléfono: dos números
 * distintos no se esperan entre sí, y dos locales tampoco. Una colisión de
 * `hashtextextended` sólo haría esperar unos milisegundos.
 *
 * **Orden de los locks**: en una venta y en una orden de trabajo esto corre
 * ANTES de `proximoNumero`, que toma la fila del tenant. Todos los caminos
 * toman los dos en el mismo orden (o sólo éste, en /clientes), así que no hay
 * un abrazo mortal posible entre ellos.
 */
async function bloquearClave(tx: ClienteTx, tenantId: string, clave: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`clientes:telefono:${tenantId}:${clave}`}, 0))`
}

/**
 * Tira `TELEFONO_REPETIDO` si OTRO cliente del local tiene esa clave. Con el
 * lock de `bloquearClave` ya tomado por el llamador.
 *
 * El mensaje nombra al que ya lo tiene y dice qué hacer, y es el mismo en los
 * tres lugares que crean clientes: en /vender y en la recepción el remedio es
 * elegirlo de la lista; en /clientes, buscarlo.
 *
 * `findFirst` y no `findUnique`: el índice no es único (puede haber repetidos
 * de antes de este chequeo, ver schema.prisma), y con dos viejos alcanza con
 * nombrar a uno.
 */
async function exigirTelefonoLibre(
  tx: ClienteTx,
  clave: string,
  salvoId?: string,
): Promise<void> {
  const otro = await tx.cliente.findFirst({
    where: { telefonoClave: clave, ...(salvoId ? { id: { not: salvoId } } : {}) },
    orderBy: { creadoEn: 'asc' },
    select: { nombre: true },
  })
  if (otro) {
    throw new ErrorDeCliente(
      'TELEFONO_REPETIDO',
      `Ese teléfono ya lo tiene ${otro.nombre}. Si es la misma persona, buscala y elegila en vez de cargarla de nuevo.`,
    )
  }
}

/** Los dos pasos de arriba, en el único orden correcto. Sin clave (teléfono
 *  vacío o con menos de 10 dígitos) no hay nada que chequear ni que bloquear. */
async function reservarTelefono(
  tx: ClienteTx,
  tenantId: string,
  campos: CamposLimpios,
  salvoId?: string,
): Promise<void> {
  if (campos.telefonoClave === null) return
  await bloquearClave(tx, tenantId, campos.telefonoClave)
  await exigirTelefonoLibre(tx, campos.telefonoClave, salvoId)
}

/**
 * El alta, DENTRO de una transacción que abre el llamador.
 *
 * Existe separada de `crearCliente` porque el alta al vuelo tiene que nacer en
 * la misma transacción que lo que la motiva —la orden de trabajo
 * (lib/ordenes-de-trabajo/crear.ts) o la venta (lib/ventas/crear.ts)—:
 * comiteada aparte, toda falla posterior deja un cliente huérfano y el
 * reintento crea otro.
 *
 * **El chequeo de teléfono repetido vive ACÁ y no en cada pantalla**, para que
 * lo pasen todos los caminos que crean clientes. Un teléfono repetido aborta la
 * transacción entera del llamador: ni la venta ni la orden quedan a medias.
 */
export async function crearClienteEn(
  tx: ClienteTx,
  entrada: EntradaCrearCliente,
): Promise<{ id: string; nombre: string }> {
  const campos = limpiarCampos({
    nombre: entrada.nombre,
    telefono: entrada.telefono,
    email: entrada.email ?? null,
    notas: entrada.notas ?? null,
    aceptaOfertas: entrada.aceptaOfertas ?? false,
  })
  await reservarTelefono(tx, entrada.tenantId, campos)

  return tx.cliente.create({
    data: { tenantId: entrada.tenantId, ...campos },
    select: { id: true, nombre: true },
  })
}

/** El alta con su propia transacción: la de /clientes. */
export async function crearCliente(
  entrada: EntradaCrearCliente,
): Promise<{ id: string; nombre: string }> {
  return enTransaccionDeTenant(entrada.tenantId, async (tx) => crearClienteEn(tx, entrada))
}

export type EntradaEditarCliente = {
  tenantId: string
  clienteId: string
  nombre: string
  telefono: string | null
  email: string | null
  notas: string | null
  aceptaOfertas: boolean
}

/**
 * La edición: todos los campos juntos, como los manda el formulario de la
 * ficha. Un campo vacío BORRA el dato —es lo que el formulario muestra—, no
 * "deja el anterior".
 *
 * El chequeo de repetidos excluye al propio cliente: guardar la ficha sin
 * tocar el teléfono no puede chocar consigo mismo.
 *
 * `updateMany` y no `update`: RLS ya filtra por tenant, así que el cliente de
 * otro local no aparece, y con `update` eso sería un P2025 (un 500) en vez del
 * `CLIENTE_INEXISTENTE` que corresponde. Mismo criterio que `guardarDetalle`
 * (app/(app)/ventas/acciones.ts).
 */
export async function editarCliente(entrada: EntradaEditarCliente): Promise<void> {
  const campos = limpiarCampos(entrada)
  await enTransaccionDeTenant(entrada.tenantId, async (tx) => {
    await reservarTelefono(tx, entrada.tenantId, campos, entrada.clienteId)
    const { count } = await tx.cliente.updateMany({
      where: { id: entrada.clienteId },
      data: campos,
    })
    if (count === 0) {
      throw new ErrorDeCliente('CLIENTE_INEXISTENTE', 'Ese cliente ya no existe. Volvé al listado.')
    }
  })
}

/**
 * Borra un cliente SIN historia: el cargado por error, el duplicado recién
 * hecho.
 *
 * **Uno con ventas u órdenes no se borra**: las FK son `Restrict`, y aunque no
 * lo fueran, borrar la historia de compras para sacar a alguien de una lista
 * es perder datos del local. El mensaje dice cuánta historia tiene. Mismo
 * criterio que el borrado de artículos (ciclo del 2026-09-07). Para "no le
 * escribas más" está `aceptaOfertas`; no hay baja lógica en este ciclo (spec,
 * decisión 5).
 *
 * El conteo cuenta TODAS las ventas, anuladas incluidas: una anulada también
 * apunta al cliente y la FK la cuenta igual.
 *
 * El `catch` de P2003 cubre la carrera que el conteo no puede: una venta que
 * se asigna a este cliente entre el conteo y el `DELETE`. Postgres la frena con
 * la FK; acá se traduce al mismo error de dominio, sin el detalle (bajo RLS la
 * base no dice qué FK chocó).
 */
export async function borrarCliente(entrada: { tenantId: string; clienteId: string }): Promise<void> {
  try {
    await enTransaccionDeTenant(entrada.tenantId, async (tx) => {
      const cliente = await tx.cliente.findUnique({
        where: { id: entrada.clienteId },
        select: { _count: { select: { ventas: true, ordenes: true } } },
      })
      if (!cliente) {
        throw new ErrorDeCliente('CLIENTE_INEXISTENTE', 'Ese cliente ya no existe. Volvé al listado.')
      }
      const { ventas, ordenes } = cliente._count
      if (ventas > 0 || ordenes > 0) {
        throw new ErrorDeCliente(
          'CLIENTE_CON_HISTORIA',
          `Tiene ${rotuloDeHistoria(ventas, ordenes)}: no se puede borrar.`,
        )
      }
      await tx.cliente.delete({ where: { id: entrada.clienteId } })
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new ErrorDeCliente(
        'CLIENTE_CON_HISTORIA',
        'Le acaban de asignar una venta u orden: no se puede borrar.',
      )
    }
    throw e
  }
}

/** Cuántos resultados devuelve el buscador. Es una lista para elegir de un
 *  vistazo en el mostrador, no un listado paginado. */
const LIMITE_POR_DEFECTO = 10

export type ClienteEncontrado = {
  id: string
  nombre: string
  telefono: string | null
  // Cuántas órdenes de trabajo tiene este cliente — design/arandano.pen, nodo
  // `zjJc0`/`C8k7w` en "Recibir equipo" y `rJo2X`/`ARZ1K` en la ficha de la
  // orden. `Cliente.ordenes` ya es una relación (schema.prisma), así que esto
  // NO es una migración: es un `_count` que hoy nadie pedía. Vive en el TIPO
  // de retorno de `buscarClientes` y no como un campo separado que cada
  // pantalla arme por su cuenta, para que las dos pantallas que lo necesitan
  // (el buscador de la recepción y la card Cliente de la ficha) lean el mismo
  // nombre de campo — aunque cada una dispare su propia consulta de Prisma,
  // porque una viene de `cliente.findMany` y la otra de un `include` sobre
  // `ordenDeTrabajo.findFirst`.
  ordenesPrevias: number
}

// `rotuloOrdenesPrevias` ("3 órdenes previas" / "1 orden previa",
// design/arandano.pen, nodos `zjJc0`/`C8k7w`) se mudó a `./rotulos.ts`: es
// una función pura, pero un Client Component ('use client') que la importe
// de ACÁ arrastra `enTransaccionDeTenant` (y con él `pg`) a su bundle del
// navegador. Ver el comentario largo de `./rotulos.ts` para el bug real que
// esto causó y por qué no vuelve.

/**
 * Busca por nombre, email o teléfono —este último también en otro formato:
 * "1122334455" encuentra a "11 2233-4455"—. El `where` es el mismo del listado
 * de /clientes (`dondeBusca`, ./filtros.ts).
 *
 * Con el texto vacío devuelve la lista vacía y NO todos los clientes: un
 * buscador que sin texto vuelca la tabla entera es un scan sobre la pantalla
 * que más se abre del módulo.
 */
export async function buscarClientes(
  tenantId: string,
  texto: string,
  limite: number = LIMITE_POR_DEFECTO,
): Promise<ClienteEncontrado[]> {
  const where = dondeBusca(texto)
  if (where === null) return []

  const clientes = await enTransaccionDeTenant(tenantId, async (tx) =>
    tx.cliente.findMany({
      where,
      orderBy: { nombre: 'asc' },
      take: limite,
      select: { id: true, nombre: true, telefono: true, _count: { select: { ordenes: true } } },
    }),
  )

  return clientes.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    telefono: c.telefono,
    ordenesPrevias: c._count.ordenes,
  }))
}
