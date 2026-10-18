import { Prisma } from '@/generated/prisma/client'
import type { Moneda, TipoMovimientoCaja } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { cobradoDeGrupos } from '@/lib/ventas/cobrado'
import type { Totales } from '@/lib/ventas/totales'

type Decimal = Prisma.Decimal

/**
 * El efectivo del turno de caja en curso: cuánto debería haber en el cajón
 * AHORA, por moneda, y de dónde sale ese número.
 *
 * Spec: docs/superpowers/specs/2026-10-18-arqueo-de-caja-design.md
 * (decisiones 1 y 2). **El efectivo esperado se deriva, nunca se lleva a
 * mano**: es la suma de lo que el sistema ya sabe dentro de la ventana del
 * turno, y lo único que una persona escribe es lo que cuenta y lo que se lleva
 * (eso vive en `cerrarCaja`, abrir-cerrar.ts).
 *
 *     actual = apertura + cobrado − devuelto + ingresos − egresos − retiros
 *
 * por moneda. **Pesos y dólares nunca se suman**: cada término es un
 * `Totales` (`{ ars, usd }`) y la cuenta se hace pila por pila.
 */

/** Las seis magnitudes del turno más el resultado, cada una por moneda. */
export type EfectivoDelTurno = {
  apertura: Totales
  /** Cobros en EFECTIVO de ventas creadas en el turno y no anuladas. */
  cobrado: Totales
  /** Efectivo de ventas de OTRO turno anuladas durante éste: sale del cajón. */
  devuelto: Totales
  ingresos: Totales
  egresos: Totales
  retiros: Totales
  /** Lo que debería haber en el cajón. Es el "esperado" del cierre. */
  actual: Totales
}

/** Lo mínimo de la caja que la cuenta necesita. */
export type CajaDelTurno = {
  id: string
  abiertaEn: Date
  saldoInicial: Decimal
  saldoInicialUsd: Decimal
}

const cero = (): Totales => ({ ars: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) })

function sumar(a: Totales, b: Totales): Totales {
  return { ars: a.ars.add(b.ars), usd: a.usd.add(b.usd) }
}

function restar(a: Totales, b: Totales): Totales {
  return { ars: a.ars.sub(b.ars), usd: a.usd.sub(b.usd) }
}

/**
 * La cuenta, adentro de una transacción ya abierta con la GUC del tenant.
 *
 * Recibe `tx` y no un `tenantId` porque tiene DOS llamadores con necesidades
 * distintas: la lectura del panel (`turnoEnCurso`, abajo, que abre su propia
 * transacción) y el cierre (`cerrarCaja`), que la llama DESPUÉS de bloquear la
 * fila de la caja con su `UPDATE` — así el esperado que se guarda es el de ese
 * instante, recalculado, y no el que mostraba la pantalla cuando la persona
 * abrió el formulario (spec, decisión 4).
 *
 * **La ventana es `[abiertaEn, ahora)` y no lleva cota superior**, a propósito:
 * sólo se calcula para la caja ABIERTA (la del cierre todavía lo está adentro
 * de su transacción hasta el commit), y para una caja abierta "todo lo creado
 * desde que abrió" ES el turno. Una cota `lt: new Date()` metería el reloj del
 * proceso contra el `now()` de Postgres, que es quien escribe `creado_en`, sin
 * comprar nada. Una caja cerrada no se recalcula: su esperado es el que quedó
 * guardado.
 *
 * **Las cuatro decisiones del cobrado, una por cláusula del `where`:**
 *
 * - `medio: 'EFECTIVO'`: transferencias y tarjetas no pasan por el cajón.
 * - Agrupado por `Pago.moneda` (lo que el cliente ENTREGÓ), nunca por `cubre`
 *   — la misma regla que `cobradoDePagos` (lib/ventas/cobrado.ts): un pago en
 *   pesos que cubre un total en dólares metió pesos en el cajón.
 * - `venta.creadoEn` y **no `Pago.creadoEn`**: la edición de una venta
 *   (lib/ventas/editar.ts) recrea sus pagos con `creadoEn = ahora`, y filtrar
 *   por el pago movería al turno de hoy el efectivo de una venta de ayer.
 * - `venta.anuladaEn: null`: una venta creada y anulada en el mismo turno
 *   simplemente no suma (la plata entró y volvió a salir del mismo cajón).
 *
 * **Devuelto**: una venta creada ANTES de que abriera este turno y anulada
 * DURANTE éste devuelve su efectivo desde este cajón, así que se resta acá.
 * "Antes" incluye ventas cobradas sin ninguna caja abierta (`crearVenta` no la
 * exige): la devolución sale igual de este cajón.
 *
 * **Y las anuladas en el hueco entre turnos** (hallazgo de la review): una
 * venta del turno A anulada DESPUÉS de que A cerró y ANTES de que abriera B no
 * se restaba en ningún lado, mientras que lo que quedó de A —la apertura
 * sugerida de B— seguía incluyendo esa plata. La devolución salió del cajón
 * que después abrió B, así que se resta en B: para las ventas creadas antes
 * del cierre anterior (`inicioDeDevoluciones`), la ventana de la anulación
 * arranca en ese cierre y no en la apertura de este turno. Una venta creada
 * en el hueco y anulada en el hueco no entra: nunca estuvo en ningún cajón
 * contado. Sin cierre anterior, la ventana es la de siempre.
 *
 * **Límite declarado** (spec, decisión 1): una EDICIÓN de una venta de otro
 * turno que cambie efectivo (de tarjeta a efectivo) no se refleja en el turno
 * donde se hizo la corrección. La diferencia aparece en el arqueo, que es
 * justamente para eso.
 *
 * `groupBy` y `findMany`, **nunca `$queryRaw`**: la GUC de RLS la setea
 * `enTransaccionDeTenant` para la transacción entera, pero el resto del repo
 * agrega con operaciones de modelo (ver lib/inventario/valuacion.ts) y esta
 * cuenta no tiene ningún motivo para ser la excepción.
 *
 * `monto` va en la CLAVE del `groupBy` con `_count`, y no en un `_sum`, por lo
 * mismo que `pagosDelPeriodo`: mantiene el redondeo POR PAGO, y así el cobrado
 * de esta pantalla no se separa por centavos del de /ventas. Los movimientos
 * sí van con `_sum`: son montos tipeados de dos decimales, sin redondeo que
 * preservar.
 */
export async function efectivoDelTurno(tx: ClienteTx, caja: CajaDelTurno): Promise<EfectivoDelTurno> {
  // En serie y no con `Promise.all`: adentro de una transacción interactiva
  // las tres van por la MISMA conexión de todos modos, y en serie no hay que
  // confiar en cómo el driver encola statements concurrentes de una sola tx.
  const cobradoGrupos = await tx.pago.groupBy({
    by: ['moneda', 'monto'],
    where: {
      medio: 'EFECTIVO',
      venta: { creadoEn: { gte: caja.abiertaEn }, anuladaEn: null },
    },
    _count: true,
  })
  const inicio = await inicioDeDevoluciones(tx, caja)
  const devueltoGrupos = await tx.pago.groupBy({
    by: ['moneda', 'monto'],
    where: {
      medio: 'EFECTIVO',
      venta: {
        OR: [
          // Creada antes de este turno y anulada durante él (la regla de
          // siempre; incluye las del hueco entre turnos).
          { creadoEn: { lt: caja.abiertaEn }, anuladaEn: { gte: caja.abiertaEn } },
          // Creada antes del cierre anterior y anulada en el hueco: su
          // efectivo estaba en lo que quedó, y salió antes de que abriera éste.
          { creadoEn: { lt: inicio }, anuladaEn: { gte: inicio, lt: caja.abiertaEn } },
        ],
      },
    },
    _count: true,
  })
  const movimientos = await tx.movimientoDeCaja.groupBy({
    by: ['tipo', 'moneda'],
    where: { cajaId: caja.id },
    _sum: { monto: true },
  })

  const porTipo = (tipo: TipoMovimientoCaja): Totales =>
    movimientos
      .filter((m) => m.tipo === tipo)
      .reduce<Totales>((acc, m) => {
        const suma = m._sum.monto ?? new Prisma.Decimal(0)
        return m.moneda === 'USD'
          ? { ars: acc.ars, usd: acc.usd.add(suma) }
          : { ars: acc.ars.add(suma), usd: acc.usd }
      }, cero())

  const apertura: Totales = { ars: caja.saldoInicial, usd: caja.saldoInicialUsd }
  const cobrado = cobradoDeGrupos(cobradoGrupos)
  const devuelto = cobradoDeGrupos(devueltoGrupos)
  const ingresos = porTipo('INGRESO')
  const egresos = porTipo('EGRESO')
  const retiros = porTipo('RETIRO')

  const actual = restar(
    restar(restar(sumar(sumar(apertura, cobrado), ingresos), devuelto), egresos),
    retiros,
  )
  return { apertura, cobrado, devuelto, ingresos, egresos, retiros, actual }
}

/**
 * Desde cuándo una anulación le pertenece a este turno: el cierre de la caja
 * anterior del local, o la apertura de ésta si no hubo ninguna antes. La caja
 * anterior es la última cerrada ANTES de que abriera ésta (y no ésta misma,
 * que adentro de `cerrarCaja` ya tiene su `cerradaEn` escrito).
 */
async function inicioDeDevoluciones(tx: ClienteTx, caja: CajaDelTurno): Promise<Date> {
  const anterior = await tx.caja.findFirst({
    where: { id: { not: caja.id }, cerradaEn: { not: null, lte: caja.abiertaEn } },
    orderBy: { cerradaEn: 'desc' },
    select: { cerradaEn: true },
  })
  return anterior?.cerradaEn ?? caja.abiertaEn
}

/**
 * Si el turno tocó algún dólar: apertura, cobro, devolución o movimiento.
 *
 * Es la regla de toda la pantalla (spec, decisión 3): **la columna de dólares
 * se muestra sólo si el turno tiene algún dólar**, para que el local que no
 * maneja dólares no vea un campo de más. Se mira cada término y no sólo el
 * `actual`: un ingreso de US$ 100 y un retiro de US$ 100 dan cero, y ese
 * turno sí tuvo dólares que el cierre tiene que mostrar.
 */
export function huboDolares(e: EfectivoDelTurno): boolean {
  return [e.apertura, e.cobrado, e.devuelto, e.ingresos, e.egresos, e.retiros].some(
    (t) => !t.usd.isZero(),
  )
}

/** Un movimiento del turno, ya listo para mostrar (sin `Decimal`). */
export type MovimientoVisible = {
  id: string
  tipo: TipoMovimientoCaja
  moneda: Moneda
  monto: string
  nota: string | null
  usuario: string
  creadoEn: Date
}

/** Los movimientos de UNA caja, del más viejo al más nuevo: se leen como un
 *  libro, en el orden en que pasaron. */
export async function movimientosDeLaCaja(tx: ClienteTx, cajaId: string): Promise<MovimientoVisible[]> {
  const filas = await tx.movimientoDeCaja.findMany({
    where: { cajaId },
    orderBy: { creadoEn: 'asc' },
    select: {
      id: true, tipo: true, moneda: true, monto: true, nota: true, creadoEn: true,
      usuario: { select: { nombre: true } },
    },
  })
  return filas.map((m) => ({
    id: m.id,
    tipo: m.tipo,
    moneda: m.moneda,
    monto: m.monto.toString(),
    nota: m.nota,
    usuario: m.usuario.nombre,
    creadoEn: m.creadoEn,
  }))
}

/** El turno abierto con todo lo que el panel de /vender muestra. */
export type TurnoEnCurso = {
  caja: CajaDelTurno & { abiertaPor: string }
  efectivo: EfectivoDelTurno
  movimientos: MovimientoVisible[]
}

/**
 * La caja abierta del tenant con su efectivo y sus movimientos, o `null` si no
 * hay ninguna. Es lo que lee `/vender` para el chip "Caja abierta · $ 55.000"
 * y su panel.
 *
 * En una transacción propia y no por `prismaParaTenant`: son tres lecturas
 * que dependen de la primera (la caja), y `efectivoDelTurno` necesita un
 * `ClienteTx`. No es por atomicidad —en READ COMMITTED cada statement ve su
 * propia foto—, y un cobro que entre entre dos lecturas se ve en la próxima
 * carga, que el cobro mismo dispara al revalidar /vender.
 */
export async function turnoEnCurso(tenantId: string): Promise<TurnoEnCurso | null> {
  return enTransaccionDeTenant(tenantId, async (tx) => {
    const caja = await tx.caja.findFirst({
      where: { cerradaEn: null },
      select: {
        id: true, abiertaEn: true, saldoInicial: true, saldoInicialUsd: true,
        abiertaPor: { select: { nombre: true } },
      },
    })
    if (!caja) return null
    const efectivo = await efectivoDelTurno(tx, caja)
    const movimientos = await movimientosDeLaCaja(tx, caja.id)
    return {
      caja: {
        id: caja.id,
        abiertaEn: caja.abiertaEn,
        saldoInicial: caja.saldoInicial,
        saldoInicialUsd: caja.saldoInicialUsd,
        abiertaPor: caja.abiertaPor.nombre,
      },
      efectivo,
      movimientos,
    }
  })
}
