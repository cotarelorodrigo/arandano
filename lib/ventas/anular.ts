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
    const venta = await tx.venta.findUnique({ where: { id: ventaId } })
    if (!venta) {
      throw new ErrorDeVenta(
        'VENTA_INEXISTENTE',
        `la venta ${ventaId} no existe en este tenant`,
      )
    }
    // Idempotente: el reintento de un click es más probable que la mala
    // intención, y anular dos veces no puede duplicar la devolución de stock.
    if (venta.anuladaEn !== null) return

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

    await tx.venta.update({
      where: { id: ventaId },
      data: { anuladaEn: new Date(), anuladaPorId: usuarioId },
    })
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
