/**
 * Lo mínimo para comparar teléfonos argentinos tipeados de cualquier forma.
 *
 * Nació en `lib/bot/numeros-de-prueba.ts` (ciclo del modo prueba del bot,
 * 2026-09-15) y se mudó acá en el ciclo de la solapa Clientes (2026-10-18),
 * cuando apareció el segundo consumidor: la clave de duplicados de
 * `lib/clientes/telefono.ts`. Dejarla en el bot obligaba a clientes a
 * importar internals del bot, y copiarla era tener dos reglas de "qué es el
 * mismo número" que se desincronizan en silencio —el mismo defecto que este
 * repo ya pagó con las dos copias del selector de categoría—. El bot la
 * re-exporta, así que sus llamadores y sus tests no cambiaron.
 *
 * **Puro y sin imports, a propósito**: lo consumen archivos `'use client'`
 * (la pantalla del bot, el selector de clientes), y una cadena de imports que
 * llegue a `lib/db.ts` arrastraría `pg` al bundle del navegador.
 * `test/limite-cliente-servidor.test.ts` lo vigila.
 *
 * **Por qué 10 dígitos.** En Argentina código de área más número son 10, así
 * que `11 2233-4455`, `+54 9 11 2233 4455` y el `5491122334455` que entrega
 * Kapso terminan en los mismos diez. El caso que NO salva es el número
 * tipeado con 0 y 15 (`011 15 2233-4455`): los códigos de área tienen largo
 * variable y cualquier heurística para sacar el 15 le erraría a alguno.
 */

/** Cuántos dígitos finales identifican un teléfono argentino. */
export const DIGITOS_DE_LA_CLAVE = 10

export function digitosDe(texto: string): string {
  return texto.replace(/\D/g, '')
}

/** Los últimos diez dígitos, o todos si hay menos: no inventa ninguno. */
export function ultimos10(digitos: string): string {
  return digitos.slice(-DIGITOS_DE_LA_CLAVE)
}
