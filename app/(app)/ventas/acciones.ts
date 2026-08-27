'use server'

import { revalidatePath } from 'next/cache'
import { exigirPermiso } from '@/lib/permisos/guarda'
import { anularVenta } from '@/lib/ventas/anular'
import { ErrorDeVenta } from '@/lib/ventas/errores'

export type EstadoAnulacion = { error: string | null; aviso: string | null }

/**
 * Anular una venta.
 *
 * Detrás de `VENTAS_ANULAR`, y el guard va acá y no sólo en la pantalla: una
 * action se invoca sin pasar por ningún componente. Anular devuelve el stock
 * y da de baja plata cobrada del período, así que sigue siendo peligroso —
 * pero ahora es el dueño quien decide si lo delega, en vez de que lo decida
 * el código. Ver el mismo razonamiento en app/(app)/usuarios/acciones.ts.
 */
export async function anular(
  _e: EstadoAnulacion,
  datos: FormData,
): Promise<EstadoAnulacion> {
  try {
    const sesion = await exigirPermiso('VENTAS_ANULAR')
    const ventaId = String(datos.get('ventaId') ?? '').trim()
    await anularVenta({ tenantId: sesion.tenant.id, ventaId, usuarioId: sesion.usuario.id })
    revalidatePath('/ventas')
    revalidatePath(`/ventas/${ventaId}`)
    // El stock vuelve por movimientos compensatorios, no borrando los
    // originales: por eso se puede decir que "volvió" sin mentir.
    return { error: null, aviso: 'Venta anulada. El stock volvió al inventario.' }
  } catch (e) {
    if (e instanceof ErrorDeVenta) return { error: e.message, aviso: null }
    throw e
  }
}
