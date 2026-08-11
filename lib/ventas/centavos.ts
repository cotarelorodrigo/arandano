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
 * Este archivo NO importa Prisma: lo importa un componente cliente.
 */

const DECIMALES_DINERO = 2
const DECIMALES_CANTIDAD = 3
// La cotización se guarda con CUATRO. Truncarla a tres movería el total de un
// pago en dólares y desalinearía el botón respecto del servidor.
const DECIMALES_COTIZACION = 4

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

/** Centavos a texto con dos decimales, que es como la columna lo guarda. */
export function deCentavos(centavos: number): string {
  const signo = centavos < 0 ? '-' : ''
  const abs = Math.abs(centavos)
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Milésimas a texto, que es como la cantidad viaja al servidor. */
export function deMilesimas(milesimas: number): string {
  const signo = milesimas < 0 ? '-' : ''
  const abs = Math.abs(milesimas)
  return `${signo}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`
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
