/**
 * Los errores de la cotización del dólar.
 *
 * **Este archivo no importa nada**, igual que `lib/canje/errores.ts`: la
 * pantalla de `/vender` es `'use client'`, y el día que necesite distinguir un
 * código no puede arrastrar `pg` al bundle del navegador.
 */
export type CodigoErrorDeCotizacion =
  // Vacía, cero, negativa, con más de dos decimales o más grande de lo que
  // entra en `Decimal(12, 2)`.
  | 'VALOR_INVALIDO'
  // Difiere en más de la mitad de la vigente y no vino confirmada. NO es un
  // rechazo: es la pregunta "¿seguro?" que el spec pide ante un cero de más.
  | 'SALTO_GRANDE'
  // La PRIMERA carga del local está fuera del rango verosímil
  // (`esPrimeraInverosimil`) y no vino confirmada. La misma pregunta que el
  // salto, para cuando no hay vigente contra la cual comparar.
  | 'INVEROSIMIL'

/** Con código y no sólo con mensaje, por lo mismo que `ErrorDePlan`: la action
 *  tiene que distinguir "pedí confirmación" de "eso no es un dólar" sin parsear
 *  el texto. */
export class ErrorDeCotizacion extends Error {
  constructor(
    readonly codigo: CodigoErrorDeCotizacion,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeCotizacion'
  }
}
