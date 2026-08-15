export type CodigoErrorDeCliente = 'NOMBRE_VACIO'

/**
 * Con código y no sólo con mensaje, igual que ErrorDeInventario y ErrorDeVenta:
 * la pantalla tiene que poder distinguir qué pasó sin parsear strings.
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
