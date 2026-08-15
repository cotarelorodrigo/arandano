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
): Promise<{ id: string; nombre: string; telefono: string | null }[]> {
  const busqueda = texto.trim()
  if (busqueda === '') return []

  return enTransaccionDeTenant(tenantId, async (tx) =>
    tx.cliente.findMany({
      where: {
        OR: [
          { nombre: { contains: busqueda, mode: 'insensitive' } },
          { telefono: { contains: busqueda } },
        ],
      },
      orderBy: { nombre: 'asc' },
      take: limite,
      select: { id: true, nombre: true, telefono: true },
    }),
  )
}
