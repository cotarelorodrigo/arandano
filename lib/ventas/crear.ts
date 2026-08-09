import { Prisma } from '@/generated/prisma/client'
import type { MedioPago, Moneda } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import {
  totalDeItems,
  totalDePagos,
  excedeEscala,
  ESCALA_CANTIDAD,
  ESCALA_DINERO,
  ESCALA_COTIZACION,
} from './totales'
import { exigirCliente, exigirUsuario } from './pertenencia'
import { ErrorDeVenta, traducirErrorDeBase } from './errores'

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
    // ANTES de multiplicar, no después: `cantidad` se valida y se persiste en la
    // misma escala en que Postgres la guarda, así que el total que se calcula
    // acá es el que la fila va a explicar. Ver `excedeEscala` en totales.ts.
    if (excedeEscala(i.cantidad, ESCALA_CANTIDAD)) {
      throw new ErrorDeVenta(
        'ESCALA_EXCEDIDA',
        `la cantidad de ${i.articuloId} tiene a lo sumo ${ESCALA_CANTIDAD} decimales`,
      )
    }
  }
  // Invariantes del DOMINIO, no del transporte, y por eso viven acá y no en un
  // validador de la capa HTTP que todavía no existe: un pago negativo cierra la
  // suma contra el total —`[+900000 EFECTIVO, -899000 TARJETA]` contra un total
  // de 1000— y deja la caja pidiendo 900 mil pesos en efectivo que nunca
  // entraron. Y una cotización en cero deja un pago en dólares del que ya no se
  // puede reconstruir a qué valor se tomó, que es exactamente lo que el campo
  // existe para guardar. Una devolución es una venta anulada, no un pago en
  // negativo.
  for (const p of pagos) {
    if (p.monto.lessThanOrEqualTo(0)) {
      throw new ErrorDeVenta(
        'MONTO_INVALIDO',
        `el monto de un pago ${p.medio} tiene que ser mayor que cero`,
      )
    }
    if (p.cotizacion.lessThanOrEqualTo(0)) {
      throw new ErrorDeVenta(
        'COTIZACION_INVALIDA',
        `la cotización de un pago ${p.moneda} tiene que ser mayor que cero`,
      )
    }
    if (excedeEscala(p.monto, ESCALA_DINERO)) {
      throw new ErrorDeVenta(
        'ESCALA_EXCEDIDA',
        `el monto de un pago ${p.medio} tiene a lo sumo ${ESCALA_DINERO} decimales`,
      )
    }
    if (excedeEscala(p.cotizacion, ESCALA_COTIZACION)) {
      throw new ErrorDeVenta(
        'ESCALA_EXCEDIDA',
        `la cotización de un pago ${p.moneda} tiene a lo sumo ${ESCALA_COTIZACION} decimales`,
      )
    }
  }

  try {
    return await enTransaccionDeTenant(tenantId, async (tx) => {
      // Las FKs hacia el cliente y el usuario, resueltas a mano: las de Postgres
      // no distinguen tenants. El porqué completo está en `pertenencia.ts`.
      if (clienteId !== undefined) await exigirCliente(tx, clienteId)
      await exigirUsuario(tx, usuarioId)

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

      // TODO lo que se puede validar ya se validó: `proximoNumero` toma el lock
      // de la fila del tenant y lo retiene hasta el commit, o sea que serializa
      // todas las ventas de ese negocio. Cada consulta que se haga después es
      // tiempo que la otra caja pasa esperando, así que va lo más tarde posible.
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
          // Campo por campo, igual que los ítems dos líneas arriba: un
          // `...p` dejaría pasar cualquier propiedad de más que traiga un body
          // JSON ya parseado, y Prisma la rechaza con `PrismaClientValidationError`
          // —un 500 sin `codigo`— en vez del `ErrorDeVenta` que el resto de esta
          // función usa para todo lo demás.
          pagos: {
            create: pagos.map((p) => ({
              tenantId,
              medio: p.medio,
              moneda: p.moneda,
              monto: p.monto,
              cotizacion: p.cotizacion,
            })),
          },
        },
      })

      // Ordenado por `articuloId`, igual que el `findMany` de `anularVenta`: el
      // `update` de abajo toma el lock de la fila del artículo, y dos
      // transacciones que tomen los mismos locks en orden distinto se
      // deadlockean (`40P01`), que sale como error crudo de Prisma. Un orden
      // total y común a todo el motor es lo que lo hace imposible. Los ítems de
      // la venta NO se reordenan: el ticket conserva el orden en que se
      // cargaron, y los `INSERT` de `venta_items` sólo toman locks compartidos
      // (`FOR KEY SHARE`), que no se bloquean entre sí.
      const paraStock = lineas
        .filter((l) => l.esProducto)
        .sort((a, b) => (a.articuloId < b.articuloId ? -1 : a.articuloId > b.articuloId ? 1 : 0))

      for (const l of paraStock) {
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
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
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
  // Cero filas significa que el tenant no existe, o que existe y RLS no lo deja
  // ver —que para el motor es lo mismo—. Sin este guard, `filas[0]` es
  // `undefined` y el llamador recibe un `TypeError` en vez de un `ErrorDeVenta`:
  // un 500 sin `codigo` justo en el único lugar de la función que habla SQL
  // crudo y no tiene a Prisma traduciendo por él.
  if (filas.length === 0) {
    throw new ErrorDeVenta('TENANT_INEXISTENTE', `el tenant ${tenantId} no existe`)
  }
  return filas[0].proximo_numero_venta
}
