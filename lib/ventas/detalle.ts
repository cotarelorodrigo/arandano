/**
 * El detalle de una venta: texto libre que el local anota sobre ella — a quién
 * se le entregó, una dirección, un teléfono suelto.
 *
 * **No significa nada para el motor.** No participa de ningún total, de ninguna
 * validación de plata ni de ningún invariante: es un campo que alguien lee,
 * nunca uno que el sistema interpreta. Ésa es la propiedad que hace segura la
 * decisión de que se pueda editar una venta ya cobrada — ver el spec del ciclo.
 *
 * **Este módulo no importa nada, a propósito.** `punto-de-venta.tsx` y
 * `formularios.tsx` llevan 'use client' e importan `TOPE_DETALLE` de VALOR; un
 * solo import que llegue a `lib/db.ts` arrastraría `pg` al bundle del navegador
 * y tiraría abajo la compilación del cliente entera. Es el bug que
 * test/limite-cliente-servidor.test.ts existe para no repetir, y el mismo
 * motivo por el que `lib/ventas/centavos.ts` tampoco importa nada.
 */

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
 * **Vacío, sólo espacios y ausente son lo MISMO**: la ausencia del dato, o sea
 * `null`. Un `''` guardado sería una tercera respuesta que ninguna pantalla
 * sabe distinguir de las otras dos. Es el mismo criterio con el que
 * `crearVenta` ya trata un `imeiCapturado` vacío: el camino por defecto —nadie
 * anotó nada— no puede ser un error ni una fila con basura adentro.
 *
 * **Y lo que pasa el tope se CORTA, no se rechaza.** Un cartel rojo en el
 * mostrador por una nota larga sería frenar un cobro por lo único de esa
 * pantalla que no es plata. El `maxLength` de los dos textarea ya impide llegar
 * acá desde la pantalla; este corte es la red para un POST armado a mano.
 *
 * El segundo `trim()` es por el corte: puede caer justo sobre un espacio, y un
 * detalle que termina en espacio es lo que el primero existe para evitar.
 */
export function normalizarDetalle(texto: string | null | undefined): string | null {
  if (texto === null || texto === undefined) return null
  const limpio = texto.trim().slice(0, TOPE_DETALLE).trim()
  return limpio === '' ? null : limpio
}
