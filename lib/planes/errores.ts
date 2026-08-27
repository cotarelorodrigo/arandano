export type CodigoErrorDePlan =
  | 'NOMBRE_VACIO'
  | 'NOMBRE_REPETIDO'
  | 'PORCENTAJE_INVALIDO'
  | 'CUOTAS_INVALIDAS'
  | 'MEDIO_INVALIDO'
  | 'PLAN_INEXISTENTE'

/** Con código y no sólo con mensaje, por lo mismo que `ErrorDeVenta`: la
 *  pantalla tiene que poder distinguir "ese nombre ya está" de "ese porcentaje
 *  no se puede", y parsear el texto es la forma de que eso se rompa la primera
 *  vez que alguien mejore la redacción. */
export class ErrorDePlan extends Error {
  constructor(
    readonly codigo: CodigoErrorDePlan,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDePlan'
  }
}
