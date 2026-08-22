import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { ErrorDeCliente } from './errores'

export type EntradaCrearCliente = {
  tenantId: string
  nombre: string
  telefono: string | null
}

/**
 * El alta mínima, DENTRO de una transacción que abre el llamador.
 *
 * Existe separada de `crearCliente` porque el alta al vuelo de la recepción
 * tiene que nacer en la misma transacción que la orden: comiteada aparte, toda
 * falla posterior deja un cliente huérfano y el reintento crea otro. Ver
 * lib/ordenes-de-trabajo/crear.ts.
 */
export async function crearClienteEn(
  tx: ClienteTx,
  entrada: EntradaCrearCliente,
): Promise<{ id: string; nombre: string }> {
  const nombre = entrada.nombre.trim()
  if (nombre === '') {
    throw new ErrorDeCliente('NOMBRE_VACIO', 'el cliente necesita un nombre')
  }
  const telefono = entrada.telefono?.trim() || null

  return tx.cliente.create({
    data: { tenantId: entrada.tenantId, nombre, telefono },
    select: { id: true, nombre: true },
  })
}

/**
 * El alta mínima con su propia transacción: nombre y teléfono. La sección
 * /clientes completa (listado, edición, historial) es su propio ciclo y no
 * entra acá.
 */
export async function crearCliente(
  entrada: EntradaCrearCliente,
): Promise<{ id: string; nombre: string }> {
  return enTransaccionDeTenant(entrada.tenantId, async (tx) => crearClienteEn(tx, entrada))
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

/**
 * "3 órdenes previas" / "1 orden previa" (design/arandano.pen, nodos
 * `zjJc0`/`C8k7w`). Vive acá, junto con `buscarClientes`, y no en ninguna de
 * las dos pantallas que lo consumen: el CONTEO no se puede compartir —son dos
 * consultas de Prisma distintas, una por cliente encontrado y otra por la
 * relación del cliente de una orden ya cargada—, pero la REDACCIÓN sí, y hoy
 * no existía en ningún helper de texto del proyecto (relevamiento, §9.4).
 */
export function rotuloOrdenesPrevias(n: number): string {
  return n === 1 ? '1 orden previa' : `${n} órdenes previas`
}

/**
 * Busca por nombre o por teléfono.
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
  const busqueda = texto.trim()
  if (busqueda === '') return []

  const clientes = await enTransaccionDeTenant(tenantId, async (tx) =>
    tx.cliente.findMany({
      where: {
        OR: [
          { nombre: { contains: busqueda, mode: 'insensitive' } },
          { telefono: { contains: busqueda } },
        ],
      },
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
