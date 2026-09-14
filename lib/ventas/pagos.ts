import { Prisma } from '@/generated/prisma/client'
import type { MedioPago, Moneda } from '@/generated/prisma/client'
import type { ClienteTx } from '@/lib/tenant/transaccion'
import {
  totalesDePagos,
  montoEntregado,
  recargoDePago,
  excedeEscala,
  ESCALA_DINERO,
  ESCALA_COTIZACION,
  type Totales,
} from './totales'
import { ErrorDeVenta } from './errores'

/**
 * La forma en que un pago llega desde afuera del motor.
 *
 * **Vive acá y no en `crear.ts`** desde que hay dos escritores de pagos: el
 * cobro (`crearVenta`) y la corrección (`reemplazarPagos`). Los dos aplican la
 * MISMA regla de plata, y tenerla en dos lugares es el defecto que este repo
 * ya pagó con las dos implementaciones del selector de categoría.
 */
export type PagoDeVenta = {
  medio: MedioPago
  moneda: Moneda
  /**
   * Lo que este pago cubre de la venta, A PRECIO DE LISTA. Va **en dólares si
   * el pago toca dólares de algún lado** (`moneda` o `cubre`), y en pesos si
   * no toca ninguno — ver `baseEnDolares` en totales.ts, que es donde vive esa
   * regla y por qué nada divide. NO es lo que entra a la caja: eso es
   * `montoEntregado(p) + recargo`, y lo calcula el servidor.
   */
  base: Prisma.Decimal
  cotizacion: Prisma.Decimal
  /** Cuál de los dos totales paga esta fila. Ausente vale `ARS`. */
  cubre?: Moneda
  /** El plan con el que se cobra esta parte. Sin plan, precio de lista. */
  planId?: string
}

export type PagoNormalizado = Omit<PagoDeVenta, 'cubre'> & { cubre: Moneda }

export type PagoResuelto = PagoNormalizado & {
  /** El porcentaje con el que se calculó `recargo`. `null` sin plan. */
  porcentaje: Prisma.Decimal | null
  recargo: Prisma.Decimal
  monto: Prisma.Decimal
}

/**
 * Normaliza `cubre` y valida los invariantes de DOMINIO de cada fila.
 *
 * Un pago negativo cierra la suma contra el total —`[+900000 EFECTIVO,
 * -899000 TARJETA]` contra un total de 1000— y deja la caja pidiendo 900 mil
 * pesos en efectivo que nunca entraron. Una devolución es una venta anulada,
 * no un pago en negativo. Y una cotización en cero deja un pago en dólares del
 * que ya no se puede reconstruir a qué valor se tomó.
 */
export function normalizarPagos(pagos: PagoDeVenta[]): PagoNormalizado[] {
  const normalizados = pagos.map((p) => ({ ...p, cubre: p.cubre ?? ('ARS' as Moneda) }))
  for (const p of normalizados) {
    if (p.base.lessThanOrEqualTo(0)) {
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
    if (excedeEscala(p.base, ESCALA_DINERO)) {
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
  return normalizados
}

/**
 * Resuelve los planes contra la transacción del tenant y congela el recargo.
 *
 * RLS ya filtra por tenant, así que el plan de otro local simplemente no
 * aparece y cae en `PLAN_INEXISTENTE`, igual que uno inventado: son la misma
 * situación para quien está cobrando.
 *
 * **`porcentajesPrevios` es lo único que distingue un cobro de una
 * corrección.** Es el mapa `planId → porcentaje` que la venta YA tenía:
 * `crearVenta` no lo pasa —una venta nueva no tiene nada viejo que respetar— y
 * `reemplazarPagos` sí. Un plan que la venta ya usaba conserva su porcentaje
 * aunque el plan haya cambiado desde entonces; uno que no estaba entra con el
 * de hoy, porque ahí sí es un cobro nuevo.
 *
 * Va como parámetro explícito y no como una rama adentro de la función: el
 * llamador es quien sabe si está cobrando o corrigiendo.
 *
 * **`planesDeLaVenta` es lo mismo aplicado a la VIGENCIA**, y por el mismo
 * motivo. Es el conjunto de `planId` que la venta ya traía; `crearVenta` no lo
 * pasa y `reemplazarPagos` sí. Un plan dado de baja que está ahí adentro se
 * resuelve igual —la corrección revalida el juego entero, así que ese pago se
 * vuelve a resolver aunque nadie lo esté tocando—, y uno que no está se sigue
 * rechazando, porque ahí sí es un cobro nuevo.
 *
 * **Es un conjunto aparte y NO las claves de `porcentajesPrevios`.** Ese mapa
 * excluye los pagos con `porcentaje` NULL —los cobrados antes de que la
 * columna existiera—, así que reusarlo dejaría sin tolerancia justo a las
 * ventas más viejas, que son las que más chance tienen de haber usado un plan
 * que el local ya retiró.
 */
export async function resolverPagosConRecargo(
  tx: ClienteTx,
  pagos: PagoNormalizado[],
  porcentajesPrevios?: ReadonlyMap<string, Prisma.Decimal>,
  planesDeLaVenta?: ReadonlySet<string>,
): Promise<PagoResuelto[]> {
  const idsDePlan = [...new Set(pagos.flatMap((p) => (p.planId ? [p.planId] : [])))]
  const planes = idsDePlan.length
    ? await tx.planDePago.findMany({ where: { id: { in: idsDePlan } } })
    : []
  const planPorId = new Map(planes.map((p) => [p.id, p]))

  return pagos.map((p) => {
    if (p.planId === undefined) {
      return { ...p, porcentaje: null, recargo: new Prisma.Decimal(0), monto: montoEntregado(p) }
    }
    const plan = planPorId.get(p.planId)
    // Desactivado se trata como inexistente A PROPÓSITO, al revés que con los
    // artículos: un plan dado de baja no se reactiva para cobrar una venta, se
    // elige otro. La distinción no le cambiaría la salida a nadie.
    //
    // **Salvo que la venta ya lo tuviera** (`planesDeLaVenta`, que sólo pasa la
    // corrección). Ahí no hay ningún cobro nuevo: el pago ya existe con ese
    // plan, nadie lo está eligiendo de vuelta, y rechazarlo volvería
    // incorregible toda venta que lo haya usado — incluso para corregir OTRO
    // pago, porque la corrección revalida el juego entero. El mensaje de abajo
    // encima no tendría salida: recargar no cambia nada y "elegí otro"
    // reescribiría lo que ese pago dice que fue.
    if (!plan || (plan.desactivadoEn && !planesDeLaVenta?.has(p.planId))) {
      // Sin el UUID en el mensaje: `traducir` (app/(app)/vender/acciones.ts)
      // muestra `e.message` tal cual en el cartel del mostrador, y un id
      // opaco no le dice nada a quien está cobrando ni le indica qué hacer.
      // El caso real es que el dueño dio de baja el plan desde otra
      // pestaña mientras el mostrador tenía la pantalla abierta, y la
      // salida es recargar y elegir otro. El id sí queda en el log del
      // servidor, que es donde se lo necesita para diagnosticar.
      throw new ErrorDeVenta(
        'PLAN_INEXISTENTE',
        'Ese plan de pago ya no está disponible. Recargá la pantalla y elegí otro.',
      )
    }
    if (plan.medio !== p.medio) {
      throw new ErrorDeVenta(
        'PLAN_NO_CORRESPONDE',
        `${plan.nombre} es un plan de ${plan.medio} y el pago es ${p.medio}`,
      )
    }
    // Sólo la MONEDA, ya no también la cotización. Un pago en pesos que
    // cubre el total en dólares lleva la cotización de verdad, y el
    // recargo se calcula sobre los pesos que efectivamente se entregan
    // —`montoEntregado`—, así que la cuenta cierra igual y sin dividir.
    // Lo que sigue prohibido es el plan sobre un pago ENTREGADO en
    // dólares: ahí el recargo saldría en dólares y volver a pesos sí
    // exigiría una división.
    if (p.moneda !== 'ARS') {
      throw new ErrorDeVenta(
        'PLAN_EN_DOLARES',
        'un pago con plan tiene que entregarse en pesos: el recargo va sobre la parte en pesos',
      )
    }
    const porcentaje = porcentajesPrevios?.get(p.planId) ?? plan.recargoPorcentaje
    const enPesos = montoEntregado(p)
    const recargo = recargoDePago(enPesos, porcentaje)
    return { ...p, porcentaje, recargo, monto: enPesos.add(recargo) }
  })
}

/**
 * Que los pagos cierren contra los dos totales de la venta.
 *
 * Contra las BASES y no contra los montos: el recargo no es mercadería. Y son
 * DOS comparaciones, una por moneda: una venta que cierra en pesos y no en
 * dólares es tan inválida como la que no cierra a secas.
 */
export function exigirQueCierren(pagos: PagoResuelto[], totales: Totales): void {
  const cubierto = totalesDePagos(pagos)
  if (!cubierto.ars.equals(totales.ars)) {
    throw new ErrorDeVenta(
      'PAGOS_NO_CIERRAN',
      `los pagos en pesos suman ${cubierto.ars} y el total en pesos es ${totales.ars}`,
    )
  }
  if (!cubierto.usd.equals(totales.usd)) {
    throw new ErrorDeVenta(
      'PAGOS_NO_CIERRAN',
      `los pagos en dólares suman ${cubierto.usd} y el total en dólares es ${totales.usd}`,
    )
  }
}
