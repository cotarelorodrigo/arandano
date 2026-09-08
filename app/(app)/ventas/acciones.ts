'use server'

import { revalidatePath } from 'next/cache'
import { exigirPermiso } from '@/lib/permisos/guarda'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { anularVenta } from '@/lib/ventas/anular'
import { normalizarDetalle } from '@/lib/ventas/detalle'
import { ErrorDeVenta } from '@/lib/ventas/errores'
import { esUuid } from '@/lib/uuid'

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

/** El mismo texto para el id mal formado y para la venta de otro local: son el
 *  mismo caso para quien mira la pantalla, y distinguirlos filtraría qué ids
 *  existen. */
const NO_EXISTE = 'Esa venta no existe.'

export type EstadoDetalle = { error: string | null; aviso: string | null }

/**
 * Guardar el detalle de una venta ya cobrada.
 *
 * **Hasta ahora, lo único que le pasaba a una venta después del cobro era
 * anularse.** `anular` también escribe sobre una venta cerrada
 * (`anuladaEn`/`anuladaPorId`), pero cambia su ESTADO — lo que esto estrena es
 * distinto: es la primera vez que se EDITA el contenido de una venta ya
 * cobrada. Lo que la hace segura es su alcance: actualiza UNA columna, la de
 * texto libre, filtrada por id y por tenant, y no toca ninguna otra. Nada de lo
 * que el motor de ventas garantiza —que los pagos cierren contra los totales,
 * que el stock haya bajado, que la clave de idempotencia sea única— pasa por
 * esta columna ni puede cambiar por ella.
 *
 * **Sin permiso propio**, detrás de `exigirSesion` como `ingresarMercaderia` y
 * `corregirPorConteo`. La regla de este repo es delegar por lo que la acción
 * MUEVE: `PLANES_PAGO` existe aparte porque mueve el precio de todo el
 * catálogo, `ARTICULOS_BORRAR` porque no se deshace. Esto mueve una columna de
 * texto y se corrige tipeando de nuevo.
 *
 * **Y funciona también sobre una venta anulada**, a propósito: el detalle no es
 * parte de lo que se cobró, y una venta anulada es justamente aquella sobre la
 * que alguien va a querer dejar escrito qué pasó.
 *
 * **Sin rastro de quién editó ni de qué decía antes.** Es un campo, no una
 * tabla-libro: una corrección pisa lo anterior. Está aceptado en el spec del
 * ciclo, con la salida escrita por si algún día hace falta.
 */
export async function guardarDetalle(entrada: {
  ventaId: string
  detalle: string
}): Promise<EstadoDetalle> {
  const sesion = await exigirSesion()
  const { ventaId, detalle } = entrada
  // El mismo guard que el resto de las pantallas con id en la URL: sin esto,
  // Prisma rechaza un uuid mal formado con un error que nadie traduce y la
  // acción sale como 500 en vez de como el aviso que corresponde. El mensaje es
  // EL MISMO que el de la venta ajena, unas líneas más abajo: distinguirlos
  // filtraría qué ids existen.
  if (!esUuid(ventaId)) return { error: NO_EXISTE, aviso: null }

  // `updateMany` y no `update`: RLS ya filtra por tenant, así que la venta de
  // otro local simplemente no aparece — con `update` eso sería una excepción
  // P2025 (un 500), y con `updateMany` es `count === 0`, que es exactamente el
  // mismo caso que un id inventado.
  const { count } = await prismaParaTenant(sesion.tenant.id).venta.updateMany({
    where: { id: ventaId },
    data: { detalle: normalizarDetalle(detalle) },
  })
  if (count === 0) return { error: NO_EXISTE, aviso: null }

  revalidatePath(`/ventas/${ventaId}`)
  return { error: null, aviso: 'Detalles guardados.' }
}
