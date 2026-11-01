import type { Prisma as PrismaTipos, EstadoOrden } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { esUuid } from '@/lib/uuid'
import { puedeTransicionar } from './estados'
import { ErrorDeOrden } from './errores'
import { notaDePlata } from './plata'

/**
 * Trae la orden para operar sobre ella, o explica por qué no se puede.
 *
 * "No existe" y "es de otro tenant" dan el MISMO error, a propósito: bajo RLS
 * la fila ajena no es una fila que este código descarte, es una fila que
 * Postgres nunca deja llegar. Inventar una distinción filtraría qué ids
 * existen, que no le sirve a nadie del otro lado.
 */
async function traerAbierta(
  tx: ClienteTx,
  ordenId: string,
): Promise<{
  id: string
  estado: EstadoOrden
  costo: PrismaTipos.Decimal | null
  montoCobrado: PrismaTipos.Decimal | null
  entregadaEn: Date | null
}> {
  // El `ordenId` llega de un campo escondido del formulario, así que un POST
  // armado a mano puede mandar cualquier cosa. Prisma tipa el parámetro por
  // columna (`@db.Uuid`) y rechaza lo que no tenga forma de uuid ANTES de
  // consultar, con un error crudo que `traducir` relanzaría como 500 en vez de
  // como el error de dominio que corresponde. Mismo guard y mismo motivo que
  // en app/(app)/vender/acciones.ts.
  if (!esUuid(ordenId)) {
    throw new ErrorDeOrden('ORDEN_INEXISTENTE', 'la orden no existe en este tenant')
  }

  const orden = await tx.ordenDeTrabajo.findFirst({
    where: { id: ordenId },
    select: {
      id: true,
      estado: true,
      anuladaEn: true,
      costo: true,
      montoCobrado: true,
      entregadaEn: true,
    },
  })
  if (!orden) {
    throw new ErrorDeOrden('ORDEN_INEXISTENTE', 'la orden no existe en este tenant')
  }
  if (orden.anuladaEn) {
    throw new ErrorDeOrden('ORDEN_ANULADA', 'la orden está anulada')
  }
  return {
    id: orden.id,
    estado: orden.estado,
    costo: orden.costo,
    montoCobrado: orden.montoCobrado,
    entregadaEn: orden.entregadaEn,
  }
}

export type EntradaCambiarEstado = {
  tenantId: string
  usuarioId: string
  ordenId: string
  hasta: EstadoOrden
  nota?: string | null
  // Sólo con `hasta === 'ENTREGADO'`. `undefined` = no tocar lo ya cobrado.
  montoCobrado?: PrismaTipos.Decimal | null
}

/**
 * Mueve la orden y deja su línea en la bitácora, en la misma transacción.
 *
 * Revalida el grafo aunque la pantalla ya haya dibujado sólo los botones
 * legales: una UI que esconde un botón no es una validación.
 *
 * Entregar es lo único que además toca plata: escribe `entregadaEn` (siempre,
 * también en una re-entrega por garantía: es la fecha de la última entrega) y,
 * si vino, `montoCobrado`. Si el cobro cambió algo, va un SEGUNDO evento
 * (`desde = hasta = ENTREGADO`, ver `guardarPlata`) después del de transición:
 * así el de transición queda limpio y el de plata lo sigue en el orden de `id`.
 */
export async function cambiarEstado(entrada: EntradaCambiarEstado): Promise<void> {
  const { tenantId, usuarioId, ordenId, hasta, montoCobrado } = entrada
  const nota = entrada.nota?.trim() || null

  // Antes de abrir la transacción: no hace falta la base para saberlo.
  if (montoCobrado !== undefined && hasta !== 'ENTREGADO') {
    throw new ErrorDeOrden(
      'COBRO_FUERA_DE_ENTREGA',
      'lo cobrado sólo se carga al pasar a ENTREGADO',
    )
  }
  if (montoCobrado && montoCobrado.lessThan(0)) {
    throw new ErrorDeOrden('MONTO_INVALIDO', 'lo cobrado no puede ser negativo')
  }

  await enTransaccionDeTenant(tenantId, async (tx) => {
    // La orden primero: si es de otro tenant, RLS ya no la deja ver y el error
    // tiene que ser ORDEN_INEXISTENTE. Consultar el usuario antes rompería eso
    // — con el tenant equivocado el usuarioId tampoco es suyo, y exigirUsuario
    // tiraría ErrorDeVenta antes de llegar a mirar la orden.
    const orden = await traerAbierta(tx, ordenId)
    await exigirUsuario(tx, usuarioId)

    if (!puedeTransicionar(orden.estado, hasta)) {
      throw new ErrorDeOrden(
        'TRANSICION_INVALIDA',
        `una orden en ${orden.estado} no puede pasar a ${hasta}`,
      )
    }

    await tx.ordenDeTrabajo.update({
      where: { id: orden.id },
      data:
        hasta === 'ENTREGADO'
          ? {
              estado: hasta,
              entregadaEn: new Date(),
              ...(montoCobrado !== undefined && { montoCobrado }),
            }
          : { estado: hasta },
    })
    await tx.eventoOrden.create({
      data: {
        tenantId,
        ordenId: orden.id,
        desde: orden.estado,
        hasta,
        nota,
        usuarioId,
      },
    })

    if (montoCobrado !== undefined) {
      const notaPlata = notaDePlata({
        cobrado: [orden.montoCobrado, montoCobrado],
      })
      if (notaPlata) {
        await tx.eventoOrden.create({
          data: {
            tenantId,
            ordenId: orden.id,
            desde: 'ENTREGADO',
            hasta: 'ENTREGADO',
            nota: notaPlata,
            usuarioId,
          },
        })
      }
    }
  })
}

export type EntradaGuardarDiagnostico = {
  tenantId: string
  usuarioId: string
  ordenId: string
  diagnostico: string
  montoEstimado: PrismaTipos.Decimal | null
}

/**
 * Guarda lo que encontró el técnico y el número que se le dice al cliente.
 *
 * NO cambia el estado y NO deja evento: la bitácora registra transiciones, y
 * cargar un diagnóstico no lo es. Pasar a PRESUPUESTADO es un cambio de estado
 * aparte, que la pantalla ofrece al lado.
 */
export async function guardarDiagnostico(entrada: EntradaGuardarDiagnostico): Promise<void> {
  const { tenantId, usuarioId, ordenId, montoEstimado } = entrada
  const diagnostico = entrada.diagnostico.trim() || null

  if (montoEstimado !== null && montoEstimado.lessThan(0)) {
    throw new ErrorDeOrden('MONTO_INVALIDO', 'el monto estimado no puede ser negativo')
  }

  await enTransaccionDeTenant(tenantId, async (tx) => {
    // Mismo orden que en cambiarEstado, y por la misma razón: la orden decide
    // primero si esto es ORDEN_INEXISTENTE.
    const orden = await traerAbierta(tx, ordenId)
    await exigirUsuario(tx, usuarioId)
    await tx.ordenDeTrabajo.update({
      where: { id: orden.id },
      data: { diagnostico, montoEstimado },
    })
  })
}

export type EntradaGuardarPlata = {
  tenantId: string
  usuarioId: string
  ordenId: string
  costo: PrismaTipos.Decimal | null
  // `undefined` = no tocar lo cobrado.
  montoCobrado?: PrismaTipos.Decimal | null
}

/**
 * Guarda el costo de los repuestos y, si viene, corrige lo cobrado.
 *
 * Si algo cambió deja un evento de plata: `desde = hasta` (el estado actual) y
 * en `nota` qué valía y qué vale (`notaDePlata`). Esa forma es la marca: ninguna
 * transición legal deja `desde === hasta` (lo fija el test "ningún estado
 * transiciona a sí mismo" de estados.test.ts), así que un lector distingue un
 * evento de plata de una transición sin ambigüedad (`esEventoDePlata`). Si no
 * cambió nada no se escribe nada: un guardado sin cambios no ensucia el
 * historial.
 */
export async function guardarPlata(entrada: EntradaGuardarPlata): Promise<void> {
  const { tenantId, usuarioId, ordenId, costo, montoCobrado } = entrada

  if (costo !== null && costo.lessThan(0)) {
    throw new ErrorDeOrden('MONTO_INVALIDO', 'el costo no puede ser negativo')
  }
  if (montoCobrado && montoCobrado.lessThan(0)) {
    throw new ErrorDeOrden('MONTO_INVALIDO', 'lo cobrado no puede ser negativo')
  }

  await enTransaccionDeTenant(tenantId, async (tx) => {
    // Mismo orden que en guardarDiagnostico, y por la misma razón.
    const orden = await traerAbierta(tx, ordenId)
    await exigirUsuario(tx, usuarioId)

    if (montoCobrado !== undefined && orden.entregadaEn === null) {
      throw new ErrorDeOrden('SIN_ENTREGAR', 'la orden nunca se entregó: no tiene nada cobrado')
    }

    const nota = notaDePlata({
      costo: [orden.costo, costo],
      ...(montoCobrado !== undefined && {
        cobrado: [orden.montoCobrado, montoCobrado],
      }),
    })
    if (!nota) return

    await tx.ordenDeTrabajo.update({
      where: { id: orden.id },
      data: { costo, ...(montoCobrado !== undefined && { montoCobrado }) },
    })
    await tx.eventoOrden.create({
      data: {
        tenantId,
        ordenId: orden.id,
        desde: orden.estado,
        hasta: orden.estado,
        nota,
        usuarioId,
      },
    })
  })
}

export type EntradaAnularOrden = {
  tenantId: string
  usuarioId: string
  ordenId: string
}

/**
 * Anula, sin tocar el estado.
 *
 * Quién y cuándo viven en la fila, exactamente como en `Venta`, y no en un
 * evento. Antes la razón era que `desde = hasta` no lo produce ninguna
 * transición; ahora esa forma es la marca de un evento de plata (ver
 * `guardarPlata`), así que un evento de anulación sería indistinguible de uno
 * de plata. Sigue en la fila por lo mismo que en `Venta`.
 *
 * Anular dos veces falla en vez de ser idempotente: la segunda vez es alguien
 * que no vio que ya estaba anulada, y decírselo es más útil que no hacer nada.
 */
export async function anularOrden(entrada: EntradaAnularOrden): Promise<void> {
  const { tenantId, usuarioId, ordenId } = entrada

  await enTransaccionDeTenant(tenantId, async (tx) => {
    // Mismo orden que en cambiarEstado, y por la misma razón: la orden decide
    // primero si esto es ORDEN_INEXISTENTE.
    const orden = await traerAbierta(tx, ordenId)
    await exigirUsuario(tx, usuarioId)
    await tx.ordenDeTrabajo.update({
      where: { id: orden.id },
      data: { anuladaEn: new Date(), anuladaPorId: usuarioId },
    })
  })
}
