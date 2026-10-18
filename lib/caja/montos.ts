import { Prisma } from '@/generated/prisma/client'
import { ESCALA_DINERO, excedeEscala } from '@/lib/ventas/totales'
import { aDecimal, ErrorDeFormato } from '@/lib/formato/numeros'
import { estaVacio } from '@/lib/formato/gramatica'
import { ErrorDeCaja, type CodigoErrorDeCaja } from './errores'

type Decimal = Prisma.Decimal

// Decimal(12,2): 12 dígitos totales, ESCALA_DINERO (2) de escala, 10 que le
// quedan a la parte entera. Sin este chequeo, un monto con más dígitos
// enteros llega crudo a Postgres y sale como un error de desborde sin código
// de dominio.
const DIGITOS_ENTEROS_MAXIMOS = 10

/** El largo máximo de una nota (de movimiento o de cierre). Un motivo de
 *  egreso es una frase; sin tope, un formulario manipulado guarda un libro. */
export const LARGO_MAXIMO_NOTA = 500

/**
 * Un monto de plata de la caja, tipeado.
 *
 * Es la validación que antes vivía sólo para el saldo inicial
 * (`validarSaldoInicial`, en abrir-cerrar.ts), generalizada en el ciclo del
 * arqueo (2026-10-18) porque el cierre y los movimientos tipean plata con las
 * MISMAS reglas: la gramática de `aDecimal` (lib/formato/numeros.ts) —la de
 * todo campo de plata del producto, así que `'1,50'` entra y `'NaN'`, `'0x10'`
 * o `'1_000'` no—, nunca negativo, a lo sumo dos decimales y dentro de la
 * precisión de `Decimal(12,2)`.
 *
 * `rotulo` es cómo el mensaje nombra el campo ("el saldo inicial", "el monto")
 * y `codigo` qué código sale: la apertura sigue saliendo con SALDO_INVALIDO,
 * que es el código que sus tests y su UI ya conocen.
 *
 * El chequeo de negativo no tiene hoy ningún valor que lo dispare —la
 * gramática no deja pasar ningún signo— y se deja igual: es una regla de
 * negocio de la caja, no un accidente de cómo está escrita la gramática.
 */
export function validarMonto(texto: string, rotulo: string, codigo: CodigoErrorDeCaja): Decimal {
  let monto: Decimal
  try {
    monto = aDecimal(texto, rotulo)
  } catch (e) {
    if (e instanceof ErrorDeFormato) {
      throw new ErrorDeCaja(codigo, e.message, { cause: e })
    }
    throw e
  }
  if (monto.isNegative()) {
    throw new ErrorDeCaja(codigo, `${rotulo} no puede ser negativo`)
  }
  if (excedeEscala(monto, ESCALA_DINERO)) {
    throw new ErrorDeCaja(codigo, `${rotulo} tiene a lo sumo ${ESCALA_DINERO} decimales`)
  }
  const digitosEnteros = monto.trunc().abs().toFixed(0).length
  if (digitosEnteros > DIGITOS_ENTEROS_MAXIMOS) {
    throw new ErrorDeCaja(
      codigo,
      `${rotulo} no puede tener más de ${DIGITOS_ENTEROS_MAXIMOS} dígitos enteros`,
    )
  }
  return monto
}

/**
 * Igual que `validarMonto`, pero el campo vacío es CERO y no un error.
 *
 * Es la regla de los campos en dólares (la apertura plegada en "+ dólares", el
 * contado en dólares de un turno que no tuvo ninguno) y de los retirados: el
 * formulario no los muestra o los deja vacíos cuando no hay nada que poner, y
 * "no hay nada" en plata es cero. El contado en pesos NO pasa por acá: ése es
 * obligatorio (spec, decisión 4).
 */
export function validarMontoOpcional(
  texto: string | null | undefined,
  rotulo: string,
  codigo: CodigoErrorDeCaja,
): Decimal {
  if (texto === null || texto === undefined || estaVacio(texto)) return new Prisma.Decimal(0)
  return validarMonto(texto, rotulo, codigo)
}

/** Una nota opcional: recortada, vacía es `null`, y con tope de largo. */
export function normalizarNota(texto: string | null | undefined): string | null {
  const limpia = (texto ?? '').trim()
  if (limpia === '') return null
  if (limpia.length > LARGO_MAXIMO_NOTA) {
    throw new ErrorDeCaja('NOTA_INVALIDA', `la nota tiene a lo sumo ${LARGO_MAXIMO_NOTA} caracteres`)
  }
  return limpia
}
