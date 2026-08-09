import { Prisma } from '@/generated/prisma/client'
import type { MedioPago, Moneda } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { totalDeItems, totalDePagos } from './totales'
import { ErrorDeVenta } from './errores'

export type ItemDeVenta = { articuloId: string; cantidad: Prisma.Decimal }
export type PagoDeVenta = {
  medio: MedioPago
  moneda: Moneda
  monto: Prisma.Decimal
  cotizacion: Prisma.Decimal
}

export type EntradaCrearVenta = {
  tenantId: string
  // Por PARÁMETRO y no de una sesión: Auth.js todavía no existe, y esperar a
  // que exista frenaría este ciclo por algo que no cambia el diseño. Cuando
  // llegue el login, lo único que cambia es quién llama. Deuda explícita: hasta
  // entonces nada impide que un llamador pase el usuario de otro, y por eso la
  // UI no se construye antes que Auth.js.
  usuarioId: string
  clienteId?: string
  items: ItemDeVenta[]
  pagos: PagoDeVenta[]
}

export async function crearVenta(
  entrada: EntradaCrearVenta,
): Promise<{ id: string; numero: number }> {
  const { tenantId, usuarioId, clienteId, items, pagos } = entrada

  if (items.length === 0) {
    throw new ErrorDeVenta('SIN_ITEMS', 'una venta necesita al menos un ítem')
  }
  for (const i of items) {
    if (i.cantidad.lessThanOrEqualTo(0)) {
      throw new ErrorDeVenta(
        'CANTIDAD_INVALIDA',
        `la cantidad de ${i.articuloId} tiene que ser mayor que cero`,
      )
    }
  }

  return enTransaccionDeTenant(tenantId, async (tx) => {
    const articulos = await tx.articulo.findMany({
      where: { id: { in: items.map((i) => i.articuloId) } },
    })
    const porId = new Map(articulos.map((a) => [a.id, a]))

    // Congelar precio y descripción ACÁ. El artículo puede renombrarse o cambiar
    // de precio mañana; esta venta tiene que seguir diciendo lo de hoy.
    const lineas = items.map((i) => {
      const a = porId.get(i.articuloId)
      if (!a) {
        throw new ErrorDeVenta(
          'ARTICULO_INEXISTENTE',
          `el artículo ${i.articuloId} no existe en este tenant`,
        )
      }
      return {
        articuloId: a.id,
        descripcion: a.nombre,
        cantidad: i.cantidad,
        precioUnitario: a.precio,
        esProducto: a.tipo === 'PRODUCTO',
      }
    })

    const total = totalDeItems(lineas)
    if (!totalDePagos(pagos).equals(total)) {
      throw new ErrorDeVenta(
        'PAGOS_NO_CIERRAN',
        `los pagos suman ${totalDePagos(pagos)} y el total es ${total}`,
      )
    }

    const numero = await proximoNumero(tx, tenantId)

    const venta = await tx.venta.create({
      data: {
        tenantId,
        numero,
        clienteId,
        usuarioId,
        total,
        items: {
          create: lineas.map((l) => ({
            tenantId,
            articuloId: l.articuloId,
            descripcion: l.descripcion,
            cantidad: l.cantidad,
            precioUnitario: l.precioUnitario,
          })),
        },
        pagos: { create: pagos.map((p) => ({ tenantId, ...p })) },
      },
    })

    for (const l of lineas.filter((l) => l.esProducto)) {
      await tx.movimientoStock.create({
        data: {
          tenantId,
          articuloId: l.articuloId,
          delta: l.cantidad.negated(),
          motivo: 'VENTA',
          ventaId: venta.id,
          usuarioId,
        },
      })
      // RELATIVO y no absoluto: `increment` genera `SET stock = stock + $1`, así
      // que dos ventas simultáneas del mismo artículo no se pisan. Un
      // `SET stock = $leido - $cantidad` perdería una de las dos, y el test de
      // concurrencia existe para atrapar exactamente ese cambio.
      //
      // Sin validar que alcance: el stock puede quedar negativo y eso no frena
      // la venta. Es decisión de negocio, no un olvido.
      await tx.articulo.update({
        where: { id: l.articuloId },
        data: { stock: { increment: l.cantidad.negated() } },
      })
    }

    return { id: venta.id, numero }
  })
}

/**
 * El correlativo por tenant, incrementado dentro de la transacción.
 *
 * Un `UPDATE … RETURNING` y no un `count()`: contar ventas daría el mismo
 * número a dos transacciones concurrentes. Esto las serializa —toma el lock de
 * la fila del tenant— y a cambio no hay huecos ni repetidos.
 */
async function proximoNumero(tx: ClienteTx, tenantId: string): Promise<number> {
  const filas = await tx.$queryRaw<{ proximo_numero_venta: number }[]>`
    UPDATE tenants
       SET proximo_numero_venta = proximo_numero_venta + 1
     WHERE id = ${tenantId}::uuid
    RETURNING proximo_numero_venta - 1 AS proximo_numero_venta
  `
  return filas[0].proximo_numero_venta
}
