import type { ClienteTx } from '@/lib/tenant/transaccion'
import { ErrorDeVenta } from './errores'

/**
 * Las FKs hacia otras tablas del tenant, resueltas A MANO antes de escribir.
 *
 * No es desconfianza de Postgres: es que la FK de Postgres **no puede** hacer
 * este trabajo. Sus triggers corren como DUEÑO de la tabla referenciada, y el
 * dueño está exento de RLS mientras no haya `FORCE ROW LEVEL SECURITY`. El
 * `WITH CHECK` de la policy protege el `tenant_id` de la fila que se escribe,
 * no a qué filas apuntan sus FKs — así que un `clienteId` o un `usuarioId` de
 * otro negocio entraban sin que nada se quejara.
 *
 * Y lo peor no es que entren: es quién lo paga. La fila queda en el tenant que
 * la mandó, pero apuntando a una fila del otro, y a partir de ahí ese otro
 * negocio no puede dar de baja a su cliente ni a su empleado — el
 * `onDelete: Restrict` se lo impide nombrándole una tabla cuya fila ofensora
 * RLS le esconde. No hay diagnóstico posible desde adentro. Alcanza un
 * `clienteId` copiado para dejar a un tercero con un cliente que no se borra
 * nunca.
 *
 * Las consultas van por el cliente TRANSACCIONAL, que sí pasa por RLS: si la
 * fila es de otro tenant, para esta transacción sencillamente no existe. Eso es
 * lo que convierte "de otro tenant" en "inexistente", que además es lo único
 * que el llamador tiene derecho a saber.
 */
export async function exigirCliente(tx: ClienteTx, clienteId: string): Promise<void> {
  const cliente = await tx.cliente.findUnique({
    where: { id: clienteId },
    select: { id: true },
  })
  if (!cliente) {
    throw new ErrorDeVenta(
      'CLIENTE_INEXISTENTE',
      `el cliente ${clienteId} no existe en este tenant`,
    )
  }
}

export async function exigirUsuario(tx: ClienteTx, usuarioId: string): Promise<void> {
  const usuario = await tx.user.findUnique({
    where: { id: usuarioId },
    select: { id: true },
  })
  if (!usuario) {
    throw new ErrorDeVenta(
      'USUARIO_INEXISTENTE',
      `el usuario ${usuarioId} no existe en este tenant`,
    )
  }
}
