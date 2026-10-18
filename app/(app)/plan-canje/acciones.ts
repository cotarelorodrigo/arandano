'use server'

import { exigirSesion } from '@/lib/auth/sesion'
import { buscarArticulosVendibles, type ArticuloVendible } from '@/lib/ventas/buscar'

/**
 * El equipo que se vende, buscado por nombre, código o IMEI: la MISMA búsqueda
 * que `/vender` (`buscarArticulosVendibles`), así que lo que el vendedor
 * encuentra acá es lo que después encuentra en el mostrador, con el mismo
 * precio y el mismo stock.
 *
 * **Sólo sesión, sin permiso**: la calculadora es de cualquiera del local, que
 * es la mitad del pedido —"el vendedor la consulta"—. No escribe nada.
 *
 * Una action propia y no la `buscarArticulos` de `/vender`: cada pantalla trae
 * sus propias puertas, y el día que la búsqueda del mostrador pida algo más
 * (la caja abierta, un permiso) la calculadora no tiene por qué heredarlo sin
 * que nadie lo decida.
 */
export async function buscarEquipos(texto: string): Promise<ArticuloVendible[]> {
  const sesion = await exigirSesion()
  return buscarArticulosVendibles(sesion.tenant.id, texto)
}
