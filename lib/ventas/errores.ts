export type CodigoErrorDeVenta =
  | 'SIN_ITEMS'
  | 'CANTIDAD_INVALIDA'
  | 'ARTICULO_INEXISTENTE'
  | 'PAGOS_NO_CIERRAN'
  | 'VENTA_INEXISTENTE'

/**
 * Con código y no sólo con mensaje: la UI que venga después tiene que poder
 * distinguir "faltó un artículo" de "los pagos no cierran" para decir algo útil,
 * y parsear el texto de un Error es la forma de que eso se rompa en silencio la
 * primera vez que alguien mejore la redacción.
 */
export class ErrorDeVenta extends Error {
  constructor(
    readonly codigo: CodigoErrorDeVenta,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeVenta'
  }
}
