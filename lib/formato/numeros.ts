import { Prisma } from '@/generated/prisma/client'

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

/**
 * El texto de un campo, convertido a `Decimal`.
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
export function aDecimal(texto: string, campo: string): Prisma.Decimal {
  const limpio = texto.replace(/\s/g, '')

  if (limpio === '') {
    throw new ErrorDeFormato('NUMERO_INVALIDO', `falta ${campo}`)
  }
  if (SOLO_DIGITOS.test(limpio)) {
    return new Prisma.Decimal(limpio)
  }
  if (MILES_Y_DECIMALES.test(limpio)) {
    return new Prisma.Decimal(limpio.replaceAll('.', '').replace(',', '.'))
  }
  if (SOLO_MILES.test(limpio)) {
    return new Prisma.Decimal(limpio.replaceAll('.', ''))
  }

  const partido = UN_SEPARADOR.exec(limpio)
  if (partido) {
    const [, entera, decimales] = partido
    if (decimales.length === 3) {
      throw new ErrorDeFormato(
        'NUMERO_AMBIGUO',
        `no se entiende cuánto es "${texto}" en ${campo}: escribilo como ` +
          `1500,50 o como 1500, sin separador de miles`,
      )
    }
    return new Prisma.Decimal(`${entera}.${decimales}`)
  }

  throw new ErrorDeFormato('NUMERO_INVALIDO', `${campo} no es un número: "${texto}"`)
}

/** Igual, pero el vacío es `null` y no un error: el campo es opcional. */
export function aDecimalOpcional(texto: string, campo: string): Prisma.Decimal | null {
  return texto.replace(/\s/g, '') === '' ? null : aDecimal(texto, campo)
}
