import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { crearClienteEn } from '@/lib/clientes/administrar'
import { exigirCliente } from './pertenencia'
import { ErrorDeVenta } from './errores'

export type EntradaCambiarCliente = {
  tenantId: string
  ventaId: string
  /** El cliente nuevo de la venta; `null` la deja en consumidor final. */
  cliente:
    | { tipo: 'existente'; id: string }
    | { tipo: 'nuevo'; nombre: string; telefono: string | null; aceptaOfertas: boolean }
    | null
}

/**
 * Asignar, cambiar o quitar el cliente de una venta YA cobrada — "Asignar
 * cliente" en `/ventas/[id]`, para las ventas que se hicieron sin cargarlo.
 *
 * **Es seguro por lo mismo que `guardarDetalle`** (app/(app)/ventas/acciones.ts):
 * actualiza UNA columna, `cliente_id`, filtrada por id y por tenant. El cliente
 * no entra en ningún total, en ningún pago ni en ninguna validación de plata,
 * así que nada de lo que el motor de ventas garantiza puede cambiar por esto.
 * Por eso tampoco tiene permiso propio ni deja fila en `EdicionDeVenta`: esa
 * bitácora es de cómo se pagó (lo que mueve plata), y mezclarle "le pusimos
 * el cliente" la volvería ruido (spec, ajustes durante la implementación).
 *
 * **Funciona también sobre una venta anulada**, como el detalle: sigue siendo
 * de esa persona, y anularla no cambia a quién se le vendió.
 *
 * Un cliente nuevo nace en la MISMA transacción, con el mismo chequeo de
 * teléfono repetido que cualquier otra alta; si la venta no existe, el
 * rollback se lo lleva.
 *
 * El de otro tenant pasa por `exigirCliente`: la FK de Postgres no distingue
 * tenants (ver `pertenencia.ts`), y sin esto una venta de este local podría
 * quedar apuntando a un cliente de otro, que entonces no podría borrarlo nunca.
 */
export async function cambiarClienteDeVenta(entrada: EntradaCambiarCliente): Promise<void> {
  const { tenantId, ventaId, cliente } = entrada
  await enTransaccionDeTenant(tenantId, async (tx) => {
    let clienteId: string | null = null
    if (cliente?.tipo === 'existente') {
      await exigirCliente(tx, cliente.id)
      clienteId = cliente.id
    } else if (cliente?.tipo === 'nuevo') {
      clienteId = (
        await crearClienteEn(tx, {
          tenantId,
          nombre: cliente.nombre,
          telefono: cliente.telefono,
          aceptaOfertas: cliente.aceptaOfertas,
        })
      ).id
    }
    const { count } = await tx.venta.updateMany({ where: { id: ventaId }, data: { clienteId } })
    if (count === 0) throw new ErrorDeVenta('VENTA_INEXISTENTE', 'Esa venta no existe.')
  })
}
