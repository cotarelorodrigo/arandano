export type CodigoErrorDeCliente =
  | 'NOMBRE_VACIO'
  // Otro cliente del mismo local ya tiene ese teléfono (comparado por los
  // últimos 10 dígitos, `claveDeTelefono`). El mensaje lo nombra.
  | 'TELEFONO_REPETIDO'
  | 'EMAIL_INVALIDO'
  // Un id que no es de este local: inventado, borrado entre que se abrió la
  // pantalla y se guardó, o de otro tenant (RLS lo esconde y para la
  // transacción es lo mismo que no existir).
  | 'CLIENTE_INEXISTENTE'
  // Tiene ventas u órdenes de trabajo: las FK son `Restrict` y el historial no
  // se borra para sacar a un cliente de la lista.
  | 'CLIENTE_CON_HISTORIA'

/**
 * Con código y no sólo con mensaje, igual que ErrorDeInventario y ErrorDeVenta:
 * la pantalla tiene que poder distinguir qué pasó sin parsear strings.
 *
 * **Puro, sin imports**: lo importa `lib/clientes/campos.ts`, que a su vez lo
 * usan formularios `'use client'`.
 */
export class ErrorDeCliente extends Error {
  constructor(
    readonly codigo: CodigoErrorDeCliente,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeCliente'
  }
}
