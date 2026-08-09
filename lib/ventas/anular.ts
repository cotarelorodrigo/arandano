import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { ErrorDeVenta } from './errores'

export async function anularVenta(entrada: {
  tenantId: string
  ventaId: string
  usuarioId: string
}): Promise<void> {
  const { tenantId, ventaId, usuarioId } = entrada

  await enTransaccionDeTenant(tenantId, async (tx) => {
    // Idempotente: el reintento de un click es más probable que la mala
    // intención, y anular dos veces no puede duplicar la devolución de stock.
    //
    // La condición viaja DENTRO del UPDATE, no en un `if` sobre lo que devolvió
    // un `findUnique`. Leer y después decidir deja una ventana entre las dos
    // sentencias, y bajo READ COMMITTED —el nivel por defecto, que
    // `enTransaccionDeTenant` no cambia— dos anulaciones simultáneas de la misma
    // venta la leen sin anular las dos, y las dos compensan: doble
    // `ANULACION_VENTA` y stock acreditado dos veces. Un doble click en "anular"
    // alcanza para producirlo. Así, en cambio, la segunda transacción espera el
    // lock de la fila, vuelve a evaluar el `WHERE` cuando la primera comitea, se
    // lleva cero filas y no compensa nada. Es el mismo recurso que usa
    // `proximoNumero` en `crear.ts` para serializar contra su propia carrera.
    const marcadas = await tx.$queryRaw<{ id: string }[]>`
      UPDATE ventas
         SET anulada_en = now(), anulada_por_id = ${usuarioId}::uuid
       WHERE id = ${ventaId}::uuid AND anulada_en IS NULL
      RETURNING id
    `

    if (marcadas.length === 0) {
      // Cero filas tiene dos causas que el llamador no vive igual: la venta ya
      // estaba anulada (no-op silencioso) o no existe en este tenant (error).
      // El UPDATE no las distingue, así que la consulta que las separa va acá y
      // no antes — sólo corre en el camino excepcional, y como es dentro de la
      // misma transacción ve el commit de quien haya ganado la carrera.
      const existe = await tx.venta.findUnique({
        where: { id: ventaId },
        select: { id: true },
      })
      if (!existe) {
        throw new ErrorDeVenta(
          'VENTA_INEXISTENTE',
          `la venta ${ventaId} no existe en este tenant`,
        )
      }
      return
    }

    // Se compensan LOS MOVIMIENTOS QUE LA VENTA GENERÓ, no los ítems.
    // Recorrer los ítems de nuevo daría distinto si el tipo del artículo cambió
    // de PRODUCTO a SERVICIO desde entonces; derivarlo de los movimientos
    // garantiza que las dos mitades coincidan siempre.
    const movimientos = await tx.movimientoStock.findMany({
      where: { ventaId, motivo: 'VENTA' },
    })

    for (const m of movimientos) {
      await tx.movimientoStock.create({
        data: {
          tenantId,
          articuloId: m.articuloId,
          delta: m.delta.negated(),
          motivo: 'ANULACION_VENTA',
          ventaId,
          usuarioId,
        },
      })
      await tx.articulo.update({
        where: { id: m.articuloId },
        data: { stock: { increment: m.delta.negated() } },
      })
    }
  })
}

/**
 * El ingreso de mercadería y la corrección de inventario: lo que devuelve a cero
 * un stock negativo. No tiene venta asociada.
 */
export async function ajustarStock(entrada: {
  tenantId: string
  articuloId: string
  delta: Prisma.Decimal
  motivo: 'AJUSTE' | 'INGRESO'
  usuarioId: string
  nota?: string
}): Promise<void> {
  const { tenantId, articuloId, delta, motivo, usuarioId, nota } = entrada

  await enTransaccionDeTenant(tenantId, async (tx) => {
    const articulo = await tx.articulo.findUnique({ where: { id: articuloId } })
    if (!articulo) {
      throw new ErrorDeVenta(
        'ARTICULO_INEXISTENTE',
        `el artículo ${articuloId} no existe en este tenant`,
      )
    }

    await tx.movimientoStock.create({
      data: { tenantId, articuloId, delta, motivo, usuarioId, nota },
    })
    await tx.articulo.update({
      where: { id: articuloId },
      data: { stock: { increment: delta } },
    })
  })
}
