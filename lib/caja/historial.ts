import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import type { MovimientoVisible } from './efectivo'

type Decimal = Prisma.Decimal

/**
 * El historial de cierres de `/caja` (spec
 * 2026-10-18-arqueo-de-caja-design.md, decisión 5): las cajas cerradas en un
 * período, con su arqueo y sus movimientos.
 *
 * **Sólo lee lo guardado**: el esperado de un cierre es el que se recalculó en
 * su transacción y quedó en `Caja`, y acá no se vuelve a calcular. Recalcularlo
 * hoy daría otro número cada vez que alguien anule o edite una venta vieja, y
 * el historial de un cierre tiene que decir lo que pasó ese día.
 *
 * La diferencia y lo que queda NO salen de acá: se derivan en la pantalla con
 * lib/caja/arqueo.ts, la misma aritmética que el formulario de cierre.
 */

/** Por qué tope: un año entero de cierres diarios entra holgado, y un rango
 *  más largo que eso es un rango que conviene achicar, no una tabla de mil
 *  filas. La pantalla avisa cuando se llega. */
export const TOPE_DEL_HISTORIAL = 400

/** Un importe por moneda como texto, o `null` si el cierre fue sin arqueo. */
export type ImporteDelCierre = { ars: string; usd: string }

export type CierreDeCaja = {
  id: string
  abiertaEn: Date
  cerradaEn: Date
  abiertaPor: string
  cerradaPor: string
  apertura: ImporteDelCierre
  /** `null` = se cerró sin arqueo (sólo las cerradas antes de este ciclo: hoy no se puede cerrar sin contar). */
  arqueo: {
    esperado: ImporteDelCierre
    contado: ImporteDelCierre
    retirado: ImporteDelCierre
    nota: string | null
  } | null
  movimientos: MovimientoVisible[]
  /** Si el cierre tocó algún dólar: la misma regla que la pantalla del cierre. */
  conDolares: boolean
}

const texto = (d: Decimal | null) => (d ?? new Prisma.Decimal(0)).toFixed(2)

/**
 * Las cajas CERRADAS entre `desde` (incluido) y `hasta` (excluido), por la
 * fecha de cierre, de la más reciente a la más vieja.
 *
 * Por `cerradaEn` y no por `abiertaEn`: es el historial de CIERRES, y un turno
 * que abrió a las 23 y cerró a la 1 es el cierre de ese día. La caja abierta
 * no aparece —no tiene cierre todavía—: su estado vive en el chip de /vender.
 *
 * En una transacción propia porque son dos lecturas (las cajas y sus
 * movimientos) que comparten la GUC, como `turnoEnCurso`. `findMany` y nunca
 * `$queryRaw` (ver lib/inventario/valuacion.ts).
 */
export async function cierresDelPeriodo(
  tenantId: string,
  periodo: { desde: Date; hasta: Date },
): Promise<{ cierres: CierreDeCaja[]; hayMas: boolean }> {
  return enTransaccionDeTenant(tenantId, async (tx) => {
    const cajas = await tx.caja.findMany({
      where: { cerradaEn: { gte: periodo.desde, lt: periodo.hasta } },
      orderBy: { cerradaEn: 'desc' },
      take: TOPE_DEL_HISTORIAL + 1,
      select: {
        id: true, abiertaEn: true, cerradaEn: true,
        saldoInicial: true, saldoInicialUsd: true,
        esperadoArs: true, esperadoUsd: true, contadoArs: true, contadoUsd: true,
        retiradoArs: true, retiradoUsd: true, notaCierre: true,
        abiertaPor: { select: { nombre: true } },
        cerradaPor: { select: { nombre: true } },
      },
    })
    const hayMas = cajas.length > TOPE_DEL_HISTORIAL
    const visibles = cajas.slice(0, TOPE_DEL_HISTORIAL)

    // Una sola consulta para los movimientos de todas las cajas, y no una por
    // fila: con 30 cierres serían 30 viajes.
    const movimientos = visibles.length
      ? await tx.movimientoDeCaja.findMany({
          where: { cajaId: { in: visibles.map((c) => c.id) } },
          orderBy: { creadoEn: 'asc' },
          select: {
            id: true, cajaId: true, tipo: true, moneda: true, monto: true, nota: true, creadoEn: true,
            usuario: { select: { nombre: true } },
          },
        })
      : []

    const cierres = visibles.map((c): CierreDeCaja => {
      const propios = movimientos
        .filter((m) => m.cajaId === c.id)
        .map((m) => ({
          id: m.id, tipo: m.tipo, moneda: m.moneda, monto: m.monto.toString(), nota: m.nota,
          usuario: m.usuario.nombre, creadoEn: m.creadoEn,
        }))
      const arqueo =
        c.contadoArs === null
          ? null
          : {
              esperado: { ars: texto(c.esperadoArs), usd: texto(c.esperadoUsd) },
              contado: { ars: texto(c.contadoArs), usd: texto(c.contadoUsd) },
              retirado: { ars: texto(c.retiradoArs), usd: texto(c.retiradoUsd) },
              nota: c.notaCierre,
            }
      const conDolares =
        !c.saldoInicialUsd.isZero() ||
        propios.some((m) => m.moneda === 'USD') ||
        [c.esperadoUsd, c.contadoUsd, c.retiradoUsd].some((d) => d !== null && !d.isZero())
      return {
        id: c.id,
        abiertaEn: c.abiertaEn,
        // `cerradaEn` no es null: el `where` lo exige. El `!` lo dice sin un
        // `if` que nunca corre.
        cerradaEn: c.cerradaEn!,
        abiertaPor: c.abiertaPor.nombre,
        // Una caja cerrada siempre tiene quién la cerró (lo escribe el mismo
        // UPDATE que `cerradaEn`); el "—" es para una fila escrita a mano.
        cerradaPor: c.cerradaPor?.nombre ?? '—',
        apertura: { ars: c.saldoInicial.toFixed(2), usd: c.saldoInicialUsd.toFixed(2) },
        arqueo,
        movimientos: propios,
        conDolares,
      }
    })
    return { cierres, hayMas }
  })
}
