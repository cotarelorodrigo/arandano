/**
 * Los errores del plan canje.
 *
 * **Este archivo no importa nada**, igual que `lib/canje/calculo.ts`: lo
 * importa la calculadora, que es un componente `'use client'`, y un import que
 * llegara a `lib/db.ts` arrastraría `pg` al bundle del navegador
 * (`test/limite-cliente-servidor.test.ts`).
 */
export type CodigoErrorDeCanje =
  | 'BATERIA_INVALIDA'
  | 'RANGO_INVALIDO'
  | 'RANGO_SOLAPADO'
  | 'RANGO_INEXISTENTE'
  // "Usar los rangos sugeridos" sólo vale con la tabla de rangos vacía: sobre
  // rangos ya cargados, cinco más chocarían con alguno, y mezclar los del
  // dueño con los sugeridos no es lo que el botón promete.
  | 'RANGOS_YA_CARGADOS'
  | 'NOMBRE_VACIO'
  | 'NOMBRE_LARGO'
  | 'NOMBRE_REPETIDO'
  | 'MODELO_INEXISTENTE'
  | 'VALOR_INVALIDO'
  | 'MONEDA_INVALIDA'

/** Con código y no sólo con mensaje, por lo mismo que `ErrorDePlan`: la
 *  pantalla tiene que poder distinguir "ese rango se pisa con otro" de "ese
 *  nombre ya está" sin parsear el texto, que es la forma de que eso se rompa
 *  la primera vez que alguien mejore la redacción. */
export class ErrorDeCanje extends Error {
  constructor(
    readonly codigo: CodigoErrorDeCanje,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeCanje'
  }
}
