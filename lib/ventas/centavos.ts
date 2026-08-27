/**
 * La aritmética del carrito, en enteros.
 *
 * Existe porque el punto de venta corre en el NAVEGADOR y necesita el total
 * para habilitar el botón de cobrar. `Prisma.Decimal` no se puede importar en
 * el cliente sin arrastrar el cliente de Prisma entero, y `number` con
 * decimales está prohibido en este proyecto por la razón de siempre: 0,10 no
 * existe en binario y el error se acumula en cada suma.
 *
 * La salida es contar en enteros —centavos para la plata, milésimas para las
 * cantidades—, que son las escalas exactas de las columnas. Un entero de
 * JavaScript es exacto hasta 2^53 y una venta de mostrador no se le acerca.
 *
 * **Tiene que dar el mismo número que `totales.ts`**, que es quien decide de
 * verdad. Por eso redondea CADA línea antes de sumar, con ROUND_HALF_UP, igual
 * que `subtotalItem`. Sumar primero y redondear al final da distinto en los
 * bordes, y acá "distinto" significa un botón habilitado para una venta que el
 * motor va a rechazar con PAGOS_NO_CIERRAN. `centavos.test.ts` compara las dos
 * aritméticas caso por caso justamente para que no se separen.
 *
 * Este archivo NO importa Prisma: lo importa un componente cliente. Sí importa
 * `lib/formato/gramatica.ts`, que tampoco lo importa y existe justamente para
 * que las dos puntas lean un número tipeado con las MISMAS reglas.
 */

import { aDecimalCanonico, ErrorDeFormato } from '@/lib/formato/gramatica'

const DECIMALES_DINERO = 2
const DECIMALES_CANTIDAD = 3
// La cotización se guarda con CUATRO. Truncarla a tres movería el total de un
// pago en dólares y desalinearía el botón respecto del servidor.
const DECIMALES_COTIZACION = 4
const DECIMALES_PORCENTAJE = 3

/** El texto de un Decimal a un entero en la escala pedida. */
function aEntero(texto: string, decimales: number): number {
  const [entera, fraccion = ''] = texto.split('.')
  // padEnd y no un multiplicar-y-redondear: recortar o rellenar el string es
  // exacto, mientras que `Number(texto) * 100` vuelve a pasar por un flotante,
  // que es justo lo que este archivo existe para no hacer.
  const ajustada = fraccion.slice(0, decimales).padEnd(decimales, '0')
  return Number(`${entera}${ajustada}`)
}

/** Texto de un Decimal de plata (`"1500.5"`) a centavos. */
export function aCentavos(texto: string): number {
  return aEntero(texto, DECIMALES_DINERO)
}

/** Texto de un Decimal de cantidad (`"1.125"`) a milésimas. */
export function aMilesimas(texto: string): number {
  return aEntero(texto, DECIMALES_CANTIDAD)
}

/** Texto de una cotización (`"1234.5678"`) a diezmilésimas. */
export function aDiezMilesimas(texto: string): number {
  return aEntero(texto, DECIMALES_COTIZACION)
}

/**
 * Lo que la persona TIPEÓ, en la escala pedida, o NaN si la gramática lo
 * rechaza.
 *
 * Las tres funciones de abajo son la puerta por la que entra todo texto de la
 * pantalla de venta, y pasan por `aDecimalCanonico` —la misma gramática que
 * usa el server action— en vez de por una normalización propia. La versión
 * anterior sólo cambiaba la primera coma por punto y partía por punto: leía
 * `1.500,50` como uno con cincuenta cuando el servidor lo lee como mil
 * quinientos, y aceptaba `850.000` como ochocientos cincuenta que el servidor
 * rechaza por ambiguo. La pantalla MUESTRA la plata con punto de miles y coma
 * decimal, así que esas dos formas son exactamente las que alguien retipea.
 *
 * NaN y no 0 cuando no se entiende —incluido el campo VACÍO—: un cero silencioso
 * es una línea que la pantalla da por buena, deja habilitar Cobrar y el motor
 * rechaza entera. El llamador trata el NaN.
 */
function tipeadoEnEscala(texto: string, escala: (canonico: string) => number): number {
  try {
    return escala(aDecimalCanonico(texto, 'el número'))
  } catch (e) {
    // Sólo lo que la gramática entiende como entrada inválida se aplana en
    // NaN; cualquier otra cosa es un bug y tiene que llegar arriba.
    if (e instanceof ErrorDeFormato) return NaN
    throw e
  }
}

/** Lo que se tipeó como cantidad, en milésimas. NaN si no se entiende. */
export function cantidadEnMilesimas(texto: string): number {
  return tipeadoEnEscala(texto, aMilesimas)
}

/** Lo que se tipeó como plata (monto o recibido), en centavos. NaN si no. */
export function dineroEnCentavos(texto: string): number {
  return tipeadoEnEscala(texto, aCentavos)
}

/** Lo que se tipeó como cotización, en diezmilésimas. NaN si no. */
export function cotizacionEnDiezMilesimas(texto: string): number {
  return tipeadoEnEscala(texto, aDiezMilesimas)
}

// Canónico y no tipeado: esto NO pasa por `tipeadoEnEscala`, y es la única
// función de este archivo que no lo hace. Lo que entra acá es el `toString()`
// de un Decimal(6,3) que armó el servidor, no algo que alguien escribió en un
// campo — y la gramática de tipeo rechaza los negativos a propósito (ver
// lib/formato/gramatica.ts), que es justo lo que un descuento necesita.
//
// La guarda no es opcional: sin ella `aEntero('')` devuelve 0, y un cero
// silencioso es un plan que no recarga nada sin que nadie se entere.
const PORCENTAJE_CANONICO = /^-?\d+(\.\d+)?$/

/** Un porcentaje (`"13.75"`, `"-10"`) a milésimas. NaN si no se entiende. */
export function porcentajeEnMilesimas(texto: string): number {
  if (!PORCENTAJE_CANONICO.test(texto)) return NaN
  return aEntero(texto, DECIMALES_PORCENTAJE)
}

/**
 * Centavos a texto con dos decimales, que es como la columna lo guarda.
 *
 * Los dos decimales se pueden dejar rellenos porque DOS decimales nunca son
 * ambiguos para la gramática (`lib/formato/gramatica.ts` sólo duda con
 * exactamente tres), así que `1500.50` vuelve a entrar al campo de monto y el
 * servidor lo lee igual. `deMilesimas`, que sí emitía tres, no tenía esa
 * suerte — ver ahí.
 */
export function deCentavos(centavos: number): string {
  const signo = centavos < 0 ? '-' : ''
  const abs = Math.abs(centavos)
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Milésimas a texto, que es como la cantidad vuelve al campo y viaja al
 * servidor.
 *
 * **Sin ceros de relleno a la derecha**: `2000` sale `"2"` y no `"2.000"`. No
 * es cosmética. Lo que esta función devuelve se escribe en el campo de cantidad
 * y se manda tal cual al server action, que lo parsea con la gramática — y esa
 * gramática RECHAZA `"2.000"` por ambiguo, porque un punto seguido de tres
 * dígitos es tan probablemente miles como decimales. Con el relleno, sumar una
 * unidad a una línea ya cargada —pasar dos veces el lector por el mismo código,
 * el gesto más común de un mostrador— dejaba el carrito en un estado que la
 * pantalla mostraba bien y el servidor rechazaba entero, pidiendo escribir
 * "sin separador de miles" un número que nadie tipeó. Además `2.000` se lee
 * como dos mil en Argentina, así que el campo también mentía antes de enviar.
 *
 * Queda un residuo conocido: `1125` sale `"1.125"`, que la gramática sigue
 * considerando ambiguo (y `1,125` también). No hay forma de escribir mil
 * ciento veinticinco milésimas que la gramática acepte; es raro y no está en
 * el camino que se rompía, así que se deja anotado y no resuelto acá.
 */
export function deMilesimas(milesimas: number): string {
  const signo = milesimas < 0 ? '-' : ''
  const abs = Math.abs(milesimas)
  const fraccion = String(abs % 1000).padStart(3, '0').replace(/0+$/, '')
  const entera = Math.floor(abs / 1000)
  return fraccion === '' ? `${signo}${entera}` : `${signo}${entera}.${fraccion}`
}

/**
 * cantidad × precio, redondeado a centavos.
 *
 * `Math.round` ES ROUND_HALF_UP para positivos, que es lo único que llega acá:
 * las cantidades y los precios del carrito no son negativos. Para negativos
 * `Math.round` redondea hacia +∞ y NO coincidiría con el servidor — si alguna
 * vez entra un negativo por acá, esto hay que revisarlo.
 */
export function subtotalEnCentavos(cantidadMilesimas: number, precioCentavos: number): number {
  // milésimas × centavos son 10^-5 pesos; dividir por 1000 los deja en centavos.
  return Math.round((cantidadMilesimas * precioCentavos) / 1000)
}

/** La suma de subtotales YA redondeados, igual que `totalDeItems`. */
export function totalEnCentavos(
  lineas: { cantidadMilesimas: number; precioCentavos: number }[],
): number {
  return lineas.reduce(
    (acc, l) => acc + subtotalEnCentavos(l.cantidadMilesimas, l.precioCentavos),
    0,
  )
}

/**
 * Lo que vale un pago en pesos, redondeado a centavos.
 *
 * Un pago en pesos lleva cotización 1 y sale igual a su monto; uno en dólares
 * vale monto × cotización. Divide por 10^4 y no por 10^3 porque la cotización
 * viene en diezmilésimas: centavos × diezmilésimas son 10^-6 pesos.
 *
 * Espeja a `montoEnPesos` de totales.ts, incluido el redondeo por pago antes de
 * sumar.
 */
export function pesosDePagoEnCentavos(
  montoCentavos: number,
  cotizacionDiezMilesimas: number,
): number {
  return Math.round((montoCentavos * cotizacionDiezMilesimas) / 10000)
}

/** La suma de pagos YA redondeados, igual que `totalDePagos`. */
export function totalDePagosEnCentavos(
  pagos: { montoCentavos: number; cotizacionDiezMilesimas: number }[],
): number {
  return pagos.reduce(
    (acc, p) => acc + pesosDePagoEnCentavos(p.montoCentavos, p.cotizacionDiezMilesimas),
    0,
  )
}

/**
 * `Math.round` NO alcanza acá, y es la única función de este archivo donde no
 * alcanza: para positivos es ROUND_HALF_UP, pero para negativos redondea hacia
 * +∞ (`Math.round(-0.5)` da -0) mientras que el `ROUND_HALF_UP` de Decimal se
 * aleja del cero (-1). Los descuentos son negativos, así que ese medio centavo
 * separaría al navegador del servidor y dejaría el botón "Cobrar" habilitado
 * para una venta que el motor rechaza.
 */
function redondearMitadLejosDelCero(v: number): number {
  return v < 0 ? -Math.round(-v) : Math.round(v)
}

/**
 * El recargo de un pago, en centavos. Espeja a `recargoDePago` de totales.ts.
 *
 * centavos × milésimas de porcentaje son 10^-5 de un porcentaje; dividir por
 * 100.000 los deja en centavos.
 */
export function recargoEnCentavos(
  baseEnPesosCentavos: number,
  porcentajeMilesimas: number,
): number {
  return redondearMitadLejosDelCero((baseEnPesosCentavos * porcentajeMilesimas) / 100000)
}
