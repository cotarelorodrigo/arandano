/**
 * Deja un texto libre opcional listo para guardar.
 *
 * **La mecánica vive acá UNA sola vez, con el tope como parámetro.** Nació en
 * `lib/ventas/detalle.ts` y se generalizó al aparecer el segundo campo de esta
 * clase —la nota de una corrección de pagos, `lib/ventas/correccion.ts`—, que
 * necesita exactamente la misma regla con otro tope. Copiarla habría sido la
 * misma forma de defecto que este repo ya pagó con las dos implementaciones
 * del selector de categoría: dos copias que se desincronizan en silencio, con
 * el gate entero en verde.
 *
 * **Este módulo no importa nada, a propósito**: lo consumen archivos con
 * `'use client'`, y un import que llegue a `lib/db.ts` arrastraría `pg` al
 * bundle del navegador y tiraría abajo la compilación del cliente entera. La
 * regla no es "cero imports", es "ninguna cadena de imports que alcance
 * `lib/db.ts`"; acá simplemente no hace falta nada, así que no se importa nada.
 *
 * **Vacío, sólo espacios y ausente son lo MISMO**: la ausencia del dato, o sea
 * `null`. Un `''` guardado sería una tercera respuesta que ninguna pantalla
 * sabe distinguir de las otras dos.
 *
 * **Y lo que pasa el tope se CORTA, no se rechaza.** Un cartel rojo por una
 * nota larga sería frenar una operación por lo único que no es plata. El
 * `maxLength` del control ya impide llegar acá desde la pantalla; este corte es
 * la red para un POST armado a mano.
 *
 * El segundo `trim()` es por el corte: puede caer justo sobre un espacio, y un
 * texto que termina en espacio es lo que el primero existe para evitar.
 *
 * **Los saltos de línea se normalizan a `\n` ANTES que nada más**, y es lo que
 * hace que dos escritores del mismo campo coincidan: un `FormData` normaliza
 * los saltos a CRLF y el argumento de un server action queda en LF. Sin este
 * paso el MISMO texto se guardaba distinto según qué pantalla lo escribió, y un
 * CRLF cerca del tope perdía un carácter de más contra lo que el `maxLength`
 * del cliente prometía —ahí un salto cuenta dos.
 */
export function normalizarTextoLibre(
  texto: string | null | undefined,
  tope: number,
): string | null {
  if (texto === null || texto === undefined) return null
  const conSaltosNormalizados = texto.replace(/\r\n?/g, '\n')
  const limpio = conSaltosNormalizados.trim().slice(0, tope).trim()
  return limpio === '' ? null : limpio
}
