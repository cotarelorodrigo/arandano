export type CodigoDePermiso = 'USUARIO_INEXISTENTE' | 'ES_DUENO'

/** Mismo molde que ErrorDeInventario: código para el llamador, mensaje para la
 *  persona. Sólo estos dos salen a pantalla; cualquier otra cosa es un bug y
 *  tiene que verse como tal. */
export class ErrorDePermiso extends Error {
  constructor(
    readonly codigo: CodigoDePermiso,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDePermiso'
  }
}
