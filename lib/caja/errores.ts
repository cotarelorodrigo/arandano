export type CodigoErrorDeCaja =
  // El índice único parcial (`cajas_una_abierta_por_tenant`) es quien
  // sostiene esto; este código es sólo la traducción legible del P2002 que
  // produce chocar contra él.
  | 'CAJA_YA_ABIERTA'
  // Mismo código para "no hay ninguna al arrancar" y para "otra request ya
  // la cerró justo antes" (ver el `updateMany` de `cerrarCaja`): las dos
  // situaciones son, para quien llama, "no hay nada que cerrar".
  | 'SIN_CAJA_ABIERTA'
  | 'SALDO_INVALIDO'

/**
 * Con código y no sólo con mensaje, mismo criterio que `ErrorDeVenta`
 * (`lib/ventas/errores.ts`): la UI que venga después tiene que poder
 * distinguir "ya hay una caja abierta" de "no hay ninguna" para decir algo
 * útil, y parsear el texto de un `Error` es la forma de que eso se rompa en
 * silencio la primera vez que alguien mejore la redacción — que es
 * exactamente lo que hacían los tests de este módulo antes de esta clase.
 *
 * El tercer parámetro reenvía la causa original al `Error` nativo (soportado
 * desde ES2022): sin él, el `P2002` que originó `CAJA_YA_ABIERTA` se perdía
 * en el `throw new Error(mensaje)`, y con él Sentry sigue viendo la
 * excepción real de Prisma debajo de la traducción.
 */
export class ErrorDeCaja extends Error {
  constructor(
    readonly codigo: CodigoErrorDeCaja,
    mensaje: string,
    opciones?: ErrorOptions,
  ) {
    super(mensaje, opciones)
    this.name = 'ErrorDeCaja'
  }
}
