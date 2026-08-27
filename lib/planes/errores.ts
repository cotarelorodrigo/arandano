export type CodigoErrorDePlan =
  | 'NOMBRE_VACIO'
  | 'NOMBRE_REPETIDO'
  | 'PORCENTAJE_INVALIDO'
  | 'CUOTAS_INVALIDAS'
  | 'MEDIO_INVALIDO'
  // El `orden` de la edición llega tipeado, así que puede no ser un entero.
  // Sin código propio, un `orden` ilegible llegaría a Prisma como NaN y
  // volvería como 500 en vez de como cartel corregible; y meterlo bajo
  // CUOTAS_INVALIDAS haría que la pantalla no pueda distinguir cuál de los dos
  // campos hay que corregir, que es justamente para lo que existe el código.
  | 'ORDEN_INVALIDO'
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
