/**
 * La cuenta del plan canje: en qué rango cae una batería y cuánto paga el
 * cliente por el equipo nuevo después de entregar el usado.
 *
 * **Funciones puras, sin Prisma**, por dos motivos. El primero es dónde corre:
 * la calculadora de `/plan-canje` es un componente cliente que recalcula con
 * cada tecla, y `Prisma.Decimal` no se puede importar en el navegador sin
 * arrastrar el cliente de Prisma —por eso la aritmética va en centavos
 * enteros sobre `lib/ventas/centavos.ts`, la misma que usa el carrito de
 * `/vender`, y no en un `number` con decimales—. El segundo es quién la va a
 * llamar después: el ciclo que registre el canje como venta (spec, "Fuera de
 * alcance") tiene que poder usar ESTAS funciones tal cual, en el servidor,
 * para que el número que la pantalla prometió sea el que se cobra.
 *
 * Por eso `calcularCanje` devuelve un resultado estructurado —montos como
 * texto decimal canónico, moneda, y hacia dónde va la plata— y no un string
 * para mostrar: el texto lo arma la pantalla, la venta lo va a consumir como
 * datos.
 *
 * **Este archivo sólo importa módulos que tampoco importan Prisma**
 * (`lib/ventas/centavos.ts`, `lib/formato/gramatica.ts`, `./errores`).
 * `test/limite-cliente-servidor.test.ts` lo vigila.
 */

import { aCentavos, cotizacionEnDiezMilesimas, deCentavos, pesosDePagoEnCentavos } from '@/lib/ventas/centavos'
import { ErrorDeCanje } from './errores'

/** La moneda, escrita a mano: este archivo NO puede importar Prisma. */
export type MonedaDeCanje = 'ARS' | 'USD'

/** Un rango cerrado de porcentajes enteros. */
export type Rango = { minimo: number; maximo: number }

/**
 * Los rangos que ofrece el botón "Usar los rangos sugeridos", de mayor a
 * menor batería: 100 %, 90–99 %, 85–89 %, 80–84 % y menos de 80 %.
 *
 * Son los del pedido, no un estándar de la industria: Apple no publica ningún
 * corte, y cada local tiene el suyo. Por eso son una SUGERENCIA que se carga
 * con un botón y después se edita, y no filas que el sistema crea solo.
 */
export const RANGOS_SUGERIDOS: readonly Rango[] = [
  { minimo: 100, maximo: 100 },
  { minimo: 90, maximo: 99 },
  { minimo: 85, maximo: 89 },
  { minimo: 80, maximo: 84 },
  { minimo: 0, maximo: 79 },
]

export const BATERIA_MINIMA = 0
export const BATERIA_MAXIMA = 100

/** Si el número es una batería: un entero de 0 a 100. */
export function esBateriaValida(bateria: number): boolean {
  return Number.isInteger(bateria) && bateria >= BATERIA_MINIMA && bateria <= BATERIA_MAXIMA
}

// Dígitos pelados, con un "%" opcional al final: quien lee "88 %" en la
// pantalla del iPhone lo tipea con el signo, y rechazárselo sería castigarlo
// por copiar lo que está leyendo. Nada más: ni signo, ni exponente, ni
// espacios en el medio — "8 8" es un error de tipeo, no ochenta y ocho.
const BATERIA_TIPEADA = /^(\d+)\s*%?$/
// Un número con decimales: se reconoce aparte sólo para poder decir el motivo.
const CON_DECIMALES = /^\d+[.,]\d+\s*%?$/

/**
 * Lo que el vendedor tipeó en el campo de la batería.
 *
 * Devuelve un resultado y no tira: lo llama la pantalla en cada tecla, y un
 * campo a medio tipear es un estado normal, no una excepción. El mensaje es el
 * que se muestra debajo del campo.
 *
 * **"88,5" se rechaza con su propio mensaje**: es un número, pero no una
 * batería —el iPhone la muestra en enteros—, y "no es un número" no le diría
 * qué corregir.
 */
export function leerBateria(
  texto: string,
): { ok: true; bateria: number } | { ok: false; mensaje: string } {
  const limpio = texto.trim()
  if (limpio === '') return { ok: false, mensaje: 'Falta la batería.' }
  if (CON_DECIMALES.test(limpio)) {
    return { ok: false, mensaje: 'La batería va en números enteros: 88, no 88,5.' }
  }
  const partido = BATERIA_TIPEADA.exec(limpio)
  const bateria = partido ? Number(partido[1]) : Number.NaN
  if (!esBateriaValida(bateria)) {
    return { ok: false, mensaje: 'La batería es un número entero de 0 a 100.' }
  }
  return { ok: true, bateria }
}

/** Si dos rangos cerrados comparten algún porcentaje. Compartir un BORDE
 *  cuenta: 80–90 y 90–99 se pisan en el 90, y un equipo con 90 % tendría dos
 *  precios. */
export function seSolapan(a: Rango, b: Rango): boolean {
  return a.minimo <= b.maximo && b.minimo <= a.maximo
}

/**
 * El rango que contiene esa batería, o `null` si cae en un hueco.
 *
 * Genérico sobre el tipo del rango para devolver el MISMO objeto que recibió:
 * la calculadora le pasa las filas de la base, con su id, y es con ese id que
 * busca el valor de la celda.
 *
 * **Tira con una batería inválida en vez de devolver `null`**: `null` quiere
 * decir "no hay cotización", que la pantalla muestra como un dato. Un 88,5 que
 * llegara hasta acá es un bug del llamador —`leerBateria` lo rechaza antes—, y
 * disfrazarlo de "sin cotización" lo escondería.
 *
 * Si hubiera dos rangos que la contienen —no debería: `lib/canje/administrar.ts`
 * rechaza el solapamiento al escribir— gana el primero de la lista. Es una
 * respuesta determinística para un estado que no tendría que existir, no una
 * regla de negocio.
 */
export function rangoParaBateria<R extends Rango>(rangos: readonly R[], bateria: number): R | null {
  if (!esBateriaValida(bateria)) {
    throw new ErrorDeCanje('BATERIA_INVALIDA', `La batería es un número entero de 0 a 100, no ${bateria}.`)
  }
  return rangos.find((r) => r.minimo <= bateria && bateria <= r.maximo) ?? null
}

/**
 * Cómo se lee un rango en la cabecera de la tabla y en la calculadora.
 *
 * "Menos de 80 %" y no "0–79 %" para el rango que arranca en cero, porque es
 * como lo dice el mostrador; pero sólo si no llega a 100 — "menos de 101 %"
 * no lo dice nadie.
 */
export function rotuloDeRango(r: Rango): string {
  if (r.minimo === r.maximo) return `${r.minimo} %`
  if (r.minimo === 0 && r.maximo < BATERIA_MAXIMA) return `Menos de ${r.maximo + 1} %`
  return `${r.minimo}–${r.maximo} %`
}

/** Un monto con su moneda. `monto` es texto decimal canónico con dos
 *  decimales (`"600.00"`), lo que `Prisma.Decimal` y `formatearPrecio` leen
 *  sin pasar por un flotante. */
export type Monto = { monto: string; moneda: MonedaDeCanje }

/** Hacia dónde va la diferencia. La diferencia misma es siempre positiva: un
 *  usado que vale más que el equipo es plata que el local DEVUELVE, no un
 *  "paga −50" que nadie sabe cómo leer en el mostrador. */
export type SentidoDelCanje = 'PAGA_EL_CLIENTE' | 'DEVUELVE_EL_LOCAL' | 'NADA'

export type ResultadoDeCanje =
  /** No hay valor cargado para esa combinación. NO es un error: es la
   *  respuesta "consultá al encargado". El precio viaja igual para mostrarlo. */
  | { tipo: 'SIN_COTIZACION'; precio: Monto }
  /** El equipo y la tabla están en monedas distintas y no hay un dólar con
   *  qué convertir: falta, o lo tipeado no se entiende o es cero. */
  | { tipo: 'FALTA_DOLAR'; motivo: 'FALTA' | 'ILEGIBLE'; precio: Monto; valor: Monto }
  | {
      tipo: 'CALCULADO'
      sentido: SentidoDelCanje
      precio: Monto
      /** El valor del usado tal como está en la tabla, en SU moneda. */
      valor: Monto
      /** El mismo valor pasado a la moneda del equipo; igual a `valor` si no
       *  hubo conversión. */
      valorEnMonedaDelEquipo: Monto
      /** |precio − valor|, en la moneda del equipo. */
      diferencia: Monto
      /** La cotización usada, canónica; `null` si no hizo falta. */
      dolar: string | null
    }

/**
 * Cuánto paga el cliente por el equipo, entregando el usado.
 *
 * - `precio`: el del artículo que se vende, en su moneda.
 * - `valor`: lo que la tabla dice que vale el usado, o `null` si no hay celda
 *   para esa combinación de modelo y rango.
 * - `dolar`: lo que hay en "Cotización del dólar", tal cual (tipeado o la del
 *   local de hoy con la que arrancó el campo).
 *   Sólo se lee si las monedas difieren.
 *
 * **Con monedas distintas no se inventa una cotización**: la cuenta usa la
 * que está en el campo, y sin dólar no hay diferencia. El campo arranca con la
 * del local sólo si es de hoy (ciclo de la cotización del dólar, 2026-10-18,
 * docs/superpowers/specs/2026-10-18-cotizacion-del-dolar-design.md), igual que
 * el cobro de `/vender` — esa decisión es de la pantalla (`page.tsx`), no de
 * esta función, que sigue recibiendo lo que haya en el campo y nada más. Con
 * dólar, la diferencia sale **en la moneda del equipo**, que es la moneda en
 * la que el cliente va a pagar.
 *
 * El redondeo es al centavo, mitad hacia arriba, sobre el valor convertido —el
 * mismo `pesosDePagoEnCentavos` del carrito para pasar dólares a pesos—. Para
 * pasar pesos a dólares se divide con la misma regla. Todo lo que entra es
 * positivo, así que `Math.round` es mitad-hacia-arriba (ver `subtotalEnCentavos`).
 */
export function calcularCanje(entrada: {
  precio: Monto
  valor: Monto | null
  dolar: string
}): ResultadoDeCanje {
  const precioCentavos = aCentavos(entrada.precio.monto)
  const precio: Monto = { monto: deCentavos(precioCentavos), moneda: entrada.precio.moneda }

  if (!entrada.valor) return { tipo: 'SIN_COTIZACION', precio }

  const valorCentavos = aCentavos(entrada.valor.monto)
  const valor: Monto = { monto: deCentavos(valorCentavos), moneda: entrada.valor.moneda }

  let convertidoCentavos = valorCentavos
  let dolar: string | null = null

  if (valor.moneda !== precio.moneda) {
    if (entrada.dolar.trim() === '') return { tipo: 'FALTA_DOLAR', motivo: 'FALTA', precio, valor }
    const diezMilesimas = cotizacionEnDiezMilesimas(entrada.dolar)
    // NaN (no se entiende) o cero: las dos dejan la cuenta sin sentido, y la
    // pantalla dice lo mismo para las dos — "ese dólar no sirve".
    if (!(diezMilesimas > 0)) return { tipo: 'FALTA_DOLAR', motivo: 'ILEGIBLE', precio, valor }
    convertidoCentavos =
      precio.moneda === 'ARS'
        ? pesosDePagoEnCentavos(valorCentavos, diezMilesimas)
        : Math.round((valorCentavos * 10000) / diezMilesimas)
    dolar = textoDeCotizacion(diezMilesimas)
  }

  const neto = precioCentavos - convertidoCentavos
  return {
    tipo: 'CALCULADO',
    sentido: neto > 0 ? 'PAGA_EL_CLIENTE' : neto < 0 ? 'DEVUELVE_EL_LOCAL' : 'NADA',
    precio,
    valor,
    valorEnMonedaDelEquipo: { monto: deCentavos(convertidoCentavos), moneda: precio.moneda },
    diferencia: { monto: deCentavos(Math.abs(neto)), moneda: precio.moneda },
    dolar,
  }
}

/** Diezmilésimas a texto canónico, sin ceros de relleno más allá de los dos
 *  decimales: `12500000` → `"1250"`, `12505000` → `"1250.50"`. Es lo que la
 *  pantalla muestra como "a $ 1.250,50 el dólar" y lo que una venta guardaría
 *  en `Pago.cotizacion`. */
function textoDeCotizacion(diezMilesimas: number): string {
  const entera = Math.floor(diezMilesimas / 10000)
  const fraccion = String(diezMilesimas % 10000).padStart(4, '0').replace(/0+$/, '')
  if (fraccion === '') return String(entera)
  return `${entera}.${fraccion.padEnd(2, '0')}`
}
