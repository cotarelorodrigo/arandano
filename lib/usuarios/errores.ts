export type CodigoErrorDeUsuario =
  | 'MAIL_REPETIDO'
  | 'ULTIMO_DUENO'
  | 'NO_EXISTE'
  | 'CLAVE_CORTA'

/**
 * Con código y no sólo con mensaje: la UI tiene que poder decidir qué mostrar
 * sin parsear strings, que es lo que se rompe en silencio al traducir un texto.
 * Mismo patrón que lib/ventas/errores.ts.
 */
export class ErrorDeUsuario extends Error {
  constructor(
    readonly codigo: CodigoErrorDeUsuario,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeUsuario'
  }
}
