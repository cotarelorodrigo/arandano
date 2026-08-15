import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { ErrorDeCliente } from './errores'

export type EntradaCrearCliente = {
  tenantId: string
  nombre: string
  telefono: string | null
}

/**
 * El alta mínima: nombre y teléfono. Existe para el alta AL VUELO desde la
 * recepción de un equipo — la sección /clientes completa (listado, edición,
 * historial) es su propio ciclo y no entra acá.
 */
export async function crearCliente(
  entrada: EntradaCrearCliente,
): Promise<{ id: string; nombre: string }> {
  const nombre = entrada.nombre.trim()
  if (nombre === '') {
    throw new ErrorDeCliente('NOMBRE_VACIO', 'el cliente necesita un nombre')
  }
  const telefono = entrada.telefono?.trim() || null

  return enTransaccionDeTenant(entrada.tenantId, async (tx) => {
    const c = await tx.cliente.create({
      data: { tenantId: entrada.tenantId, nombre, telefono },
      select: { id: true, nombre: true },
    })
    return c
  })
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
