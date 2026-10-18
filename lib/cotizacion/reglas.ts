import { esDeHoy } from '@/lib/formato/fechas'
import { formatearCotizacion, formatearDiaYMes, formatearPesosRedondos } from '@/lib/formato/mostrar'
import { aCentavos, deCentavos, pesosDePagoEnCentavos, aDiezMilesimas } from '@/lib/ventas/centavos'

/**
 * Las reglas de la cotización del dólar del local: cuándo se usa sola, y qué
 * se dice al lado cuando se usa.
 *
 * Spec: docs/superpowers/specs/2026-10-18-cotizacion-del-dolar-design.md. Este
 * ciclo revierte la regla del 2026-08-29 ("la cotización nunca se precarga")
 * pero NO su motivo: un dólar que nadie actualizó es exactamente el número
 * equivocado. Por eso todo lo de acá gira alrededor de una sola pregunta —¿es
 * de HOY, en hora argentina?— y de decir la fecha cuando no lo es.
 *
 * **Este archivo no importa Prisma ni `lib/db`**, y lo que importa tampoco:
 * lo consumen el punto de venta y la calculadora del plan canje, que son
 * `'use client'` (`test/limite-cliente-servidor.test.ts` lo vigila). Por eso la
 * plata va en texto canónico (`"1450.00"`) y se cuenta en enteros
 * (`lib/ventas/centavos.ts`), no en `Prisma.Decimal`.
 */

/**
 * La cotización vigente del local tal como la mira una pantalla: el valor en
 * texto canónico (el `toString()` del Decimal, que no cruza la frontera
 * servidor→cliente) y de cuándo es. `Date` sí cruza.
 */
export type CotizacionDelLocal = { valor: string; creadaEn: Date }

/**
 * El valor de la cotización del local SI ES DE HOY; si no, `null`.
 *
 * Es lo único que se precarga en un campo de cobro (o en la calculadora del
 * canje): una de ayer no convierte nada sola, y la pantalla la muestra como
 * sugerencia con su fecha (`sugerenciaDeCotizacionVieja`). `null` también sin
 * ninguna cargada, que es el estado de todo local hasta que alguien la carga.
 */
export function cotizacionDeHoy(c: CotizacionDelLocal | null, ahora: Date): string | null {
  return c && esDeHoy(c.creadaEn, ahora) ? c.valor : null
}

/**
 * Si la cotización del local hay que mirarla con desconfianza: no hay
 * ninguna, o no es de hoy. Es lo que pinta el chip "USD" de `/vender` con el
 * ámbar de advertencia.
 */
export function esCotizacionVieja(c: CotizacionDelLocal | null, ahora: Date): boolean {
  return cotizacionDeHoy(c, ahora) === null
}

/**
 * "La del local es del 15/10: $ 1.420", debajo del campo "Cotización" de un
 * pago que cruza monedas cuando la del local NO es de hoy (y por lo tanto el
 * campo arrancó vacío). `null` cuando no hay nada que sugerir: sin cotización
 * cargada, o con una de hoy —que ya está en el campo—.
 *
 * Sugerencia y no valor: quien cobra decide si sigue valiendo. Copiarla es
 * tipearla, a propósito: el dato viejo no entra al cobro sin que alguien lo
 * haya mirado.
 */
export function sugerenciaDeCotizacionVieja(c: CotizacionDelLocal | null, ahora: Date): string | null {
  if (!c || esDeHoy(c.creadaEn, ahora)) return null
  return `La del local es del ${formatearDiaYMes(c.creadaEn)}: ${formatearCotizacion(c.valor)}`
}

/**
 * "≈ $ 1.450.000" (o "≈ $ 1.420.000 con el dólar del 15/10" si la del local es
 * vieja): un precio en dólares pasado a pesos con la cotización del local,
 * para la ficha y la lista de `/inventario`. `null` sin cotización: no se
 * inventa un número.
 *
 * **Orientativo**: el cobro sigue cobrando en la moneda del artículo, con la
 * cotización de ese pago. Por eso redondea al peso y lleva "≈". Con una vieja
 * se muestra igual —no es plata que se cobra— pero con su fecha, que es la
 * condición del spec para usar una cotización que no es de hoy.
 *
 * El producto se redondea al centavo con la misma regla que el cobro
 * (`pesosDePagoEnCentavos`), y recién después al peso para mostrar.
 */
export function equivalenteEnPesos(
  precioUsd: string,
  c: CotizacionDelLocal | null,
  ahora: Date,
  // 'corto' para la celda de 140 px de la lista de `/inventario`, donde "con
  // el dólar del" no entra en una línea: "≈ $ 1.420.000 · 15/10". La fecha va
  // igual — es la condición para usar una vieja—; lo que se acorta es la frase.
  forma: 'largo' | 'corto' = 'largo',
): string | null {
  if (!c) return null
  const centavos = pesosDePagoEnCentavos(aCentavos(precioUsd), aDiezMilesimas(c.valor))
  const texto = `≈ ${formatearPesosRedondos(deCentavos(centavos))}`
  if (esDeHoy(c.creadaEn, ahora)) return texto
  const dia = formatearDiaYMes(c.creadaEn)
  return forma === 'corto' ? `${texto} · ${dia}` : `${texto} con el dólar del ${dia}`
}

/**
 * "con el dólar a $ 1.450 del 18/10": de dónde salió la conversión de un
 * margen con costo y precio en monedas distintas. Lleva la fecha SIEMPRE, sea
 * de hoy o no: el margen se calcula también con una vieja (es un número de
 * referencia, no plata que se cobra) y el pie tiene que decir con cuál.
 */
export function conElDolar(c: CotizacionDelLocal): string {
  return `con el dólar a ${formatearCotizacion(c.valor)} del ${formatearDiaYMes(c.creadaEn)}`
}

/** Más que esto de diferencia contra la vigente pide confirmar: la mitad. */
export const SALTO_QUE_PIDE_CONFIRMAR_PORCENTAJE = 50

/**
 * Si una cotización nueva difiere de la vigente en MÁS de la mitad (en
 * cualquier dirección): el tope de cordura del spec. Un cero de más (14.500 por
 * 1.450) o uno de menos es el error más probable al cargarla, y con el
 * precargado del cobro se volvería plata mal cobrada en la venta siguiente.
 *
 * Pide confirmar, no prohíbe: una devaluación de verdad puede mover el dólar
 * más que eso, y el local tiene que poder cargarla.
 *
 * En centavos y sin dividir: `|nueva − vigente| × 100 > 50 × vigente`. Sin
 * vigente no hay contra qué comparar y no pide nada.
 */
export function esSaltoGrande(nueva: string, vigente: string | null): boolean {
  if (vigente === null) return false
  const n = aCentavos(nueva)
  const v = aCentavos(vigente)
  return Math.abs(n - v) * 100 > SALTO_QUE_PIDE_CONFIRMAR_PORCENTAJE * v
}
