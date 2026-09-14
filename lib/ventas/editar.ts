import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { exigirUsuario } from './pertenencia'
import { ErrorDeVenta, traducirErrorDeBase } from './errores'
import {
  normalizarPagos,
  resolverPagosConRecargo,
  exigirQueCierren,
  type PagoDeVenta,
} from './pagos'
import { normalizarNotaDeCorreccion } from './correccion'

/**
 * Corregir cómo se pagó una venta ya cobrada.
 *
 * **Reemplaza el juego ENTERO de pagos, no una fila.** El invariante de una
 * venta es del conjunto —los pagos cierran contra los dos totales de la
 * mercadería—, así que validar el conjunto es la regla que ya existe y validar
 * un campo aislado sería una regla nueva y más débil.
 *
 * **La mercadería no se toca**, y de ahí sale todo lo demás: los dos totales no
 * se mueven, así que la revalidación corre contra los números YA GUARDADOS y
 * no hay stock, unidades con IMEI, costos congelados ni número de venta que
 * tocar.
 *
 * **Sin idempotencia por clave**, al revés que el cobro: una corrección que
 * llega dos veces deja el mismo juego de pagos y una segunda fila de bitácora
 * con "antes" igual a "después". Eso es ruido en la bitácora, no plata
 * duplicada. El cobro necesita la clave por el lector de código de barras y el
 * F5 sobre el POST; un formulario que se abre a mano, no.
 */
export async function reemplazarPagos(entrada: {
  tenantId: string
  ventaId: string
  usuarioId: string
  pagos: PagoDeVenta[]
  nota?: string
}): Promise<void> {
  const { tenantId, ventaId, usuarioId, pagos, nota } = entrada

  // Fuera de la transacción, igual que en `crearVenta`: son invariantes de
  // dominio de cada fila y no necesitan la base. Todo lo que se pueda validar
  // antes de tomar un lock es tiempo que otra caja no pasa esperando.
  const normalizados = normalizarPagos(pagos)

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      // El lock de la fila de la venta, ANTES de leer nada más.
      //
      // Bajo READ COMMITTED —el nivel por defecto, que `enTransaccionDeTenant`
      // no cambia— dos correcciones simultáneas leen las dos el mismo estado
      // anterior, archivan las dos la misma foto, y la segunda pisa a la
      // primera. La PLATA queda bien: el último juego de pagos es uno solo y
      // cierra. Lo que queda mal es la bitácora, que diría que se pasó de A a C
      // dos veces cuando se pasó de A a B y de B a C. Una bitácora que miente
      // es peor que no tenerla, y es la única razón por la que esta función
      // existe.
      //
      // Es el mismo recurso que `proximoNumero` usa para serializar las ventas
      // de un tenant, y el mismo motivo por el que `anularVenta` mete su
      // condición DENTRO del UPDATE en vez de en un `if` sobre un `findUnique`.
      //
      // `$queryRaw` acá SÍ ve las policies de RLS: `enTransaccionDeTenant` setea
      // `arandano.tenant_id` para toda la transacción, así que la advertencia
      // sobre raw queries de CLAUDE.md —que aplica a `prismaParaTenant`, cuya
      // extensión intercepta operaciones de MODELO— no vale adentro de acá.
      // `anularVenta` ya se apoya en lo mismo. La policy de `ventas` es FOR
      // ALL, así que cubre el `FOR UPDATE` además del SELECT: la venta de otro
      // negocio no se bloquea, sencillamente no aparece.
      const bloqueadas = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM ventas WHERE id = ${ventaId}::uuid FOR UPDATE
      `
      if (bloqueadas.length === 0) {
        throw new ErrorDeVenta(
          'VENTA_INEXISTENTE',
          `la venta ${ventaId} no existe en este tenant`,
        )
      }

      // Por el API de modelo y no por el raw de arriba: así los `Decimal`
      // llegan tipados y no hay que confiar en cómo Prisma mapea un `numeric`
      // crudo. El lock ya está tomado, así que esta lectura ve el estado final.
      const venta = await tx.venta.findUniqueOrThrow({
        where: { id: ventaId },
        select: { total: true, totalUsd: true, anuladaEn: true },
      })
      if (venta.anuladaEn !== null) {
        throw new ErrorDeVenta(
          'VENTA_ANULADA',
          'Esta venta está anulada: no hay nada que corregir sobre cómo se pagó.',
        )
      }

      // Antes de escribir la FK `usuario_id` de la edición: las FK de Postgres
      // no distinguen tenants. El porqué completo está en `pertenencia.ts`.
      await exigirUsuario(tx, usuarioId)

      const vivos = await tx.pago.findMany({
        where: { ventaId },
        orderBy: { creadoEn: 'asc' },
      })

      // El porcentaje que la venta YA tenía para cada plan. No hace falta
      // identidad por fila: dentro de una misma venta un plan tiene un solo
      // porcentaje, así que alcanza con mirar qué porcentaje tenía la venta
      // para ese plan. Un pago viejo con `porcentaje` NULL —cobrado antes de
      // que la columna existiera— no entra al mapa, así que cae al porcentaje
      // de hoy, que es lo que el diálogo avisa.
      const porcentajesPrevios = new Map(
        vivos.flatMap((p) =>
          p.planDePagoId !== null && p.porcentaje !== null
            ? ([[p.planDePagoId, p.porcentaje]] as [string, Prisma.Decimal][])
            : [],
        ),
      )

      const resueltos = await resolverPagosConRecargo(tx, normalizados, porcentajesPrevios)
      // Contra los totales YA GUARDADOS y no contra los ítems recalculados: la
      // mercadería no se toca, y recalcularla abriría la puerta a que una
      // corrección de pagos mueva el total sin que nadie lo haya pedido — si un
      // artículo cambió de precio desde la venta, el total recalculado daría
      // distinto del cobrado.
      exigirQueCierren(resueltos, { ars: venta.total, usd: venta.totalUsd })

      const edicion = await tx.edicionDeVenta.create({
        data: { tenantId, ventaId, usuarioId, nota: normalizarNotaDeCorreccion(nota) },
      })

      // Archivar ANTES de borrar, obviamente, y en la misma transacción: o se
      // mueven las dos mitades o no se mueve ninguna. `pagadoEn` es el
      // `creadoEn` del pago ORIGINAL: la foto tiene que decir cuándo se cobró,
      // no cuándo se archivó, que es lo que dice el `creadoEn` propio de la
      // fila archivada.
      if (vivos.length > 0) {
        await tx.pagoArchivado.createMany({
          data: vivos.map((p) => ({
            tenantId,
            edicionId: edicion.id,
            medio: p.medio,
            moneda: p.moneda,
            cubre: p.cubre,
            monto: p.monto,
            cotizacion: p.cotizacion,
            planDePagoId: p.planDePagoId,
            porcentaje: p.porcentaje,
            recargo: p.recargo,
            pagadoEn: p.creadoEn,
          })),
        })
      }

      await tx.pago.deleteMany({ where: { ventaId } })

      // Campo por campo y no con `...p`, igual que `crearVenta`: un spread
      // dejaría pasar cualquier propiedad de más que traiga un body JSON ya
      // parseado, y Prisma la rechaza con `PrismaClientValidationError` —un 500
      // sin `codigo`— en vez del `ErrorDeVenta` que esta función usa para todo.
      await tx.pago.createMany({
        data: resueltos.map((p) => ({
          tenantId,
          ventaId,
          medio: p.medio,
          moneda: p.moneda,
          cubre: p.cubre,
          monto: p.monto,
          cotizacion: p.cotizacion,
          planDePagoId: p.planId,
          porcentaje: p.porcentaje,
          recargo: p.recargo,
        })),
      })

      // El único caché que esta operación puede mover: `total`, `totalUsd`,
      // `costoArs` y `vendidoConCosto` describen la mercadería, que no se tocó.
      await tx.venta.update({
        where: { id: ventaId },
        data: {
          recargo: resueltos.reduce((acc, p) => acc.add(p.recargo), new Prisma.Decimal(0)),
        },
      })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}
