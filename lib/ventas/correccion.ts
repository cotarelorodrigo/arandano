import { normalizarTextoLibre } from '@/lib/texto/libre'

/**
 * El tope de la nota de una corrección de pagos. Lo consumen el motor
 * (`reemplazarPagos`) y el `Textarea` del diálogo, así que vive UNA sola vez:
 * un número repetido a mano en un segundo lugar es un número que se
 * desincroniza, y el corte del servidor dejaría de coincidir con lo que el
 * `maxLength` del control promete.
 *
 * 300 y no los 500 del detalle de venta: el detalle guarda un dato de entrega
 * (una dirección, un teléfono), y esto es una frase que explica por qué se
 * corrigió.
 *
 * **Este módulo sólo importa `lib/texto/libre.ts`, que no importa nada**: lo
 * consume el diálogo de la corrección, que lleva `'use client'`. Un import que
 * llegara a `lib/db.ts` arrastraría `pg` al bundle del navegador.
 */
export const TOPE_NOTA_DE_CORRECCION = 300

/**
 * Deja la nota lista para guardar.
 *
 * La mecánica vive en `lib/texto/libre.ts`, compartida con el detalle de
 * venta: es la misma regla con otro tope —vacío, sólo espacios y ausente son
 * `null`; lo que pasa el tope se corta en vez de rechazarse; los saltos se
 * normalizan a `\n` para que los dos escritores coincidan—. El porqué de cada
 * paso está escrito ahí.
 */
export function normalizarNotaDeCorreccion(texto: string | null | undefined): string | null {
  return normalizarTextoLibre(texto, TOPE_NOTA_DE_CORRECCION)
}
