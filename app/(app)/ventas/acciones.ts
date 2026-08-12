'use server'

import { revalidatePath } from 'next/cache'
import { exigirDuenio } from '@/lib/auth/sesion'
import { anularVenta } from '@/lib/ventas/anular'
import { ErrorDeVenta } from '@/lib/ventas/errores'

export type EstadoAnulacion = { error: string | null; aviso: string | null }

/**
 * Anular una venta.
 *
 * Sólo el dueño, y el guard va acá y no sólo en la pantalla: una action se
 * invoca sin pasar por ningún componente. Ver el mismo razonamiento en
 * app/(app)/usuarios/acciones.ts.
 */
export async function anular(
  _e: EstadoAnulacion,
  datos: FormData,
): Promise<EstadoAnulacion> {
  try {
    const sesion = await exigirDuenio()
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
