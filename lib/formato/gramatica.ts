/**
 * La gramática de un número tipeado: texto de un campo → texto decimal canónico.
 *
 * Vive separada de `numeros.ts` porque este archivo NO importa Prisma, y ese es
 * todo el punto: el punto de venta corre en el NAVEGADOR y necesita decidir si
 * lo que la persona tipeó es un número —y cuánto vale— con exactamente las
 * mismas reglas que va a aplicar el servidor. Mientras la gramática vivía
 * pegada a `Prisma.Decimal`, el cliente no podía importarla y terminó con su
 * propia versión simplificada; las dos se separaron y la pantalla mostraba
 * "$1,50" para un `1.500,50` que el servidor leía como mil quinientos.
 *
 * Una sola gramática, dos consumidores: `numeros.ts` la envuelve en un
 * `Prisma.Decimal` para el servidor, y `punto-de-venta.tsx` convierte su salida
 * a enteros con `lib/ventas/centavos.ts`.
 */

export type CodigoErrorDeFormato = 'NUMERO_INVALIDO' | 'NUMERO_AMBIGUO'

/**
 * Con código y no sólo con mensaje, igual que `ErrorDeVenta` y
 * `ErrorDeUsuario`: la pantalla tiene que poder distinguir "no es un número"
 * de "no se entiende cuánto es" sin parsear el texto, que es la forma de que
 * eso se rompa en silencio la primera vez que alguien mejore la redacción.
 */
export class ErrorDeFormato extends Error {
  constructor(
    readonly codigo: CodigoErrorDeFormato,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeFormato'
  }
}

const SOLO_DIGITOS = /^\d+$/
// El formato argentino completo: miles con punto y decimales con coma. No es
// ambiguo porque las dos marcas están presentes y cada una dice qué es.
const MILES_Y_DECIMALES = /^\d{1,3}(?:\.\d{3})+,\d+$/
// Miles sin decimales: `1.500.000`. Dos o más separadores NO son ambiguos
// —un decimal de verdad nunca lleva dos—, así que acá no hay nada que
// adivinar. Un solo separador sí lo es, y ese caso lo sigue rechazando
// `UN_SEPARADOR` más abajo.
const SOLO_MILES = /^\d{1,3}(?:\.\d{3}){2,}$/
const UN_SEPARADOR = /^(\d+)[.,](\d+)$/
// Un separador seguido de tres dígitos sólo es ambiguo si lo que está a la
// izquierda puede ser un grupo de miles: uno a tres dígitos que no arranquen en
// cero. `850.000` lo es y se rechaza; `0,125` —125 gramos— no lo es, porque
// nadie escribe `0.125` queriendo decir 125, y `1234,567` tampoco, porque un
// grupo de miles no tiene cuatro dígitos. Sin este recorte, una cantidad con
// tres decimales era INENTRABLE, y tres decimales es exactamente lo que
// `Decimal(12,3)` existe para guardar.
const PUEDE_SER_MILES = /^[1-9]\d{0,2}$/

/**
 * El texto de un campo, normalizado a un decimal con punto (`"1500.50"`).
 *
 * Devuelve TEXTO y no un número: un `number` con decimales está prohibido en
 * este proyecto, y el texto es justamente lo que tanto `Prisma.Decimal` como la
 * aritmética entera del carrito saben consumir sin pasar por un flotante.
 *
 * No acepta negativos: nada de lo que este parser alimenta —precio, cantidad
 * ingresada, stock contado— puede serlo, y un signo colado es más probablemente
 * un error de tipeo que una intención.
 *
 * **Rechaza lo ambiguo en vez de adivinar.** Un separador seguido de
 * exactamente tres dígitos (`850.000`, `850,000`) es tan probablemente miles
 * como decimales, y las dos lecturas se llevan un factor de mil de diferencia:
 * un celular de ochocientos cincuenta mil pesos quedaría cargado a 850. Es la
 * misma decisión que toma `excedeEscala` en lib/ventas/totales.ts —rechazar en
 * vez de recortar en silencio— y por el mismo motivo: la información sobre qué
 * se quiso escribir la tiene la persona, no el parser.
 */
export function aDecimalCanonico(texto: string, campo: string): string {
  const limpio = texto.replace(/\s/g, '')

  if (limpio === '') {
    throw new ErrorDeFormato('NUMERO_INVALIDO', `falta ${campo}`)
  }
  if (SOLO_DIGITOS.test(limpio)) {
    return limpio
  }
  if (MILES_Y_DECIMALES.test(limpio)) {
    return limpio.replaceAll('.', '').replace(',', '.')
  }
  if (SOLO_MILES.test(limpio)) {
    return limpio.replaceAll('.', '')
  }

  const partido = UN_SEPARADOR.exec(limpio)
  if (partido) {
    const [, entera, decimales] = partido
    if (decimales.length === 3 && PUEDE_SER_MILES.test(entera)) {
      throw new ErrorDeFormato(
        'NUMERO_AMBIGUO',
        `no se entiende cuánto es "${texto}" en ${campo}: escribilo como ` +
          `1500,50 o como 1500, sin separador de miles`,
      )
    }
    return `${entera}.${decimales}`
  }

  throw new ErrorDeFormato('NUMERO_INVALIDO', `${campo} no es un número: "${texto}"`)
}

/** Si el texto está vacío no hay número, y para un campo opcional eso no es un
 *  error. La misma pregunta que se hacen `aDecimalOpcional` y la pantalla. */
export function estaVacio(texto: string): boolean {
  return texto.replace(/\s/g, '') === ''
}
