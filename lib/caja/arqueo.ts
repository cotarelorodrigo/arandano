/**
 * Las cuentas del arqueo que se muestran: la diferencia y lo que queda.
 *
 * **Este archivo no importa Prisma** (ni nada que lo importe): lo usa el
 * formulario de cierre de `/vender` —un componente `'use client'`— para
 * mostrar EN VIVO la diferencia y lo que queda mientras la persona tipea, y lo
 * usa `/caja` para las mismas dos cifras de un cierre guardado. Una sola
 * aritmética para las dos puntas es lo que impide que la pantalla del cierre
 * diga "cuadra" y el historial diga "faltan $ 0,01".
 *
 * En centavos enteros (`lib/ventas/centavos.ts`), por lo de siempre: el
 * navegador no tiene `Prisma.Decimal`, y un `number` con decimales no
 * representa 0,10. Lo que entra son textos canónicos de un Decimal
 * (`"55000.00"`, el `toString()` del servidor) o lo que se tipeó, que pasa por
 * la misma gramática que el servidor (`dineroEnCentavos`).
 *
 * La diferencia y lo que queda **se derivan y no se guardan** (spec, decisión
 * 4): `Caja` guarda esperado, contado y retirado, y estas dos funciones son la
 * única definición de las otras dos.
 */

import { aCentavos, deCentavos, dineroEnCentavos } from '@/lib/ventas/centavos'
import { precioEnSuMoneda } from '@/lib/formato/mostrar'

export type MonedaDeCaja = 'ARS' | 'USD'

/** Un importe canónico (`"-200.00"` incluido: el esperado puede ser negativo)
 *  a centavos. La gramática de tipeo rechaza el signo a propósito, así que
 *  esto NO pasa por ella: lo que entra acá lo escribió el servidor. */
export function canonicoACentavos(texto: string): number {
  return aCentavos(texto)
}

/** Lo que se tipeó en el contado o el retirado, en centavos. Vacío es cero
 *  (es lo que el servidor hace con el retirado), y lo que no se entiende es
 *  `NaN`: el llamador no muestra ninguna cuenta con un número que no es. */
export function tipeadoACentavos(texto: string): number {
  return texto.trim() === '' ? 0 : dineroEnCentavos(texto)
}

/**
 * "cuadra", "sobran $ 200,00" o "faltan $ 200,00".
 *
 * El signo de la diferencia es contado − esperado: positivo es plata de más en
 * el cajón. Dicho en palabras y no con un "+"/"−" porque es lo que la persona
 * repite en voz alta al cerrar ("me faltan doscientos").
 */
export function textoDeDiferencia(diferenciaCentavos: number, moneda: MonedaDeCaja): string {
  if (diferenciaCentavos === 0) return 'cuadra'
  const valor = precioEnSuMoneda(deCentavos(Math.abs(diferenciaCentavos)), moneda)
  return diferenciaCentavos > 0 ? `sobran ${valor}` : `faltan ${valor}`
}

/** contado − esperado, en centavos. */
export function diferencia(contadoCentavos: number, esperadoCentavos: number): number {
  return contadoCentavos - esperadoCentavos
}

/** contado − retirado: lo que queda en el cajón, y la apertura sugerida del
 *  turno siguiente. */
export function queda(contadoCentavos: number, retiradoCentavos: number): number {
  return contadoCentavos - retiradoCentavos
}
