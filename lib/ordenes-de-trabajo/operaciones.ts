import type { Prisma as PrismaTipos, EstadoOrden } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { esUuid } from '@/lib/uuid'
import { puedeTransicionar } from './estados'
import { ErrorDeOrden } from './errores'

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
): Promise<{ id: string; estado: EstadoOrden }> {
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
    select: { id: true, estado: true, anuladaEn: true },
  })
  if (!orden) {
    throw new ErrorDeOrden('ORDEN_INEXISTENTE', 'la orden no existe en este tenant')
  }
  if (orden.anuladaEn) {
    throw new ErrorDeOrden('ORDEN_ANULADA', 'la orden está anulada')
  }
  return { id: orden.id, estado: orden.estado }
}

export type EntradaCambiarEstado = {
  tenantId: string
  usuarioId: string
  ordenId: string
  hasta: EstadoOrden
  nota?: string | null
}

/**
 * Mueve la orden y deja su línea en la bitácora, en la misma transacción.
 *
 * Revalida el grafo aunque la pantalla ya haya dibujado sólo los botones
 * legales: una UI que esconde un botón no es una validación.
 */
export async function cambiarEstado(entrada: EntradaCambiarEstado): Promise<void> {
  const { tenantId, usuarioId, ordenId, hasta } = entrada
  const nota = entrada.nota?.trim() || null

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

    await tx.ordenDeTrabajo.update({ where: { id: orden.id }, data: { estado: hasta } })
    await tx.eventoOrden.create({
      data: { tenantId, ordenId: orden.id, desde: orden.estado, hasta, nota, usuarioId },
    })
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

export type EntradaAnularOrden = {
  tenantId: string
  usuarioId: string
  ordenId: string
}

/**
 * Anula, sin tocar el estado.
 *
 * Quién y cuándo viven en la fila, exactamente como en `Venta`, y no en un
 * evento: el evento tendría que decir `desde` y `hasta` el mismo estado, una
 * fila que el grafo no puede producir y que un lector no sabe interpretar.
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
