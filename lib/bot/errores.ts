export type CodigoErrorDeBot =
  | 'SIN_INTEGRACION'
  | 'INSTRUCCIONES_LARGAS'
  | 'NUMERO_AJENO'
  | 'SIN_NUMERO'
  | 'YA_CONECTADO'

/** Con código y no sólo con mensaje, por lo mismo que `ErrorDePlan`: la
 *  pantalla tiene que poder distinguir "ese número no es de este local" de
 *  "todavía no hay integración configurada", y parsear el texto es la forma de
 *  que eso se rompa la primera vez que alguien mejore la redacción. */
export class ErrorDeBot extends Error {
  constructor(
    readonly codigo: CodigoErrorDeBot,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeBot'
  }
}
