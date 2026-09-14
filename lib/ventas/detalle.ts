/**
 * El detalle de una venta: texto libre que el local anota sobre ella — a quién
 * se le entregó, una dirección, un teléfono suelto.
 *
 * **No significa nada para el motor.** No participa de ningún total, de ninguna
 * validación de plata ni de ningún invariante: es un campo que alguien lee,
 * nunca uno que el sistema interpreta. Ésa es la propiedad que hace segura la
 * decisión de que se pueda editar una venta ya cobrada — ver el spec del ciclo.
 *
 * **Este módulo sólo importa `lib/texto/libre.ts`, que no importa nada.**
 * `punto-de-venta.tsx` y `formularios.tsx` llevan 'use client' e importan
 * `TOPE_DETALLE` de VALOR; un import que llegue a `lib/db.ts` arrastraría `pg`
 * al bundle del navegador y tiraría abajo la compilación del cliente entera. La
 * regla que impide eso no es "cero imports", es "ninguna cadena de imports que
 * alcance `lib/db.ts`" — `lib/ventas/centavos.ts` importa
 * `@/lib/formato/gramatica`, que es a su vez puro y nunca llega a `lib/db.ts`,
 * así que es seguro para el cliente. Lo mismo vale para el import de acá.
 */

import { normalizarTextoLibre } from '@/lib/texto/libre'

/**
 * El tope del texto. Vive UNA sola vez y lo consumen los cuatro lugares que lo
 * necesitan: `crearVenta`, `guardarDetalle` y los dos `Textarea`. El número
 * repetido a mano en un quinto lugar es un número que se desincroniza.
 *
 * 500 porque el campo es para un dato de entrega y no para un cuaderno.
 */
export const TOPE_DETALLE = 500

/**
 * Deja el detalle listo para guardar.
 *
 * **La mecánica vive en `lib/texto/libre.ts`**, compartida con la nota de una
 * corrección de pagos (`lib/ventas/correccion.ts`): es la misma regla con otro
 * tope, y el porqué de cada paso —vacío, espacios y ausente colapsados a
 * `null`; el corte en vez del rechazo; los dos `trim()`; los saltos
 * normalizados a `\n`— está escrito ahí. Lo que queda acá es sólo con qué tope
 * se aplica.
 *
 * **Los DOS escritores de este campo concreto** son los que hacen falta tener
 * en mente al leer aquella normalización de saltos: `/vender` postea vía
 * `FormData`, y la construcción de esa lista normaliza los saltos a CRLF;
 * `guardarDetalle` recibe un string de JS por el argumento del server action,
 * que queda en LF tal cual lo tipeó el navegador. Sin ese paso la MISMA nota se
 * guardaba distinto según qué pantalla la escribió, y un CRLF cerca del tope
 * perdía un carácter de más contra lo que el `maxLength` del cliente prometía
 * —ahí un salto cuenta dos.
 */
export function normalizarDetalle(texto: string | null | undefined): string | null {
  return normalizarTextoLibre(texto, TOPE_DETALLE)
}
