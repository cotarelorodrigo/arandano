/**
 * Los números a los que el bot les contesta en modo prueba.
 *
 * **Puro a propósito**, sin ningún import de Prisma: lo usan el webhook,
 * `lib/bot/administrar.ts` y la pantalla (`'use client'`), y un import de valor
 * que llegue a `lib/tenant/prisma.ts` arrastraría `pg` al bundle del navegador.
 * Una sola implementación de la comparación para los tres, por lo mismo que
 * existe `SelectorDeCategoria`: dos versiones de la misma regla divergen en
 * silencio.
 *
 * **Se compara por los últimos 10 dígitos.** En Argentina código de área más
 * número son 10, así que `11 2233-4455`, `+54 9 11 2233 4455` y el
 * `5491122334455` que entrega Kapso dan lo mismo. El caso que NO salva es el
 * número tipeado con 0 y 15 (`011 15 2233-4455`): no se intenta detectarlo
 * porque los códigos de área tienen largo variable y cualquier heurística le
 * erraría a alguno. La red es la pantalla, que muestra si ese número ya
 * escribió. Ver docs/superpowers/specs/2026-09-15-bot-modo-prueba-design.md.
 */

// `digitosDe` y `ultimos10` viven en `lib/texto/telefono.ts` desde el ciclo de
// la solapa Clientes, que necesitó la misma regla para su clave de duplicados
// (ver el comentario de ese archivo). Re-exportadas para que los llamadores y
// los tests del bot no cambien.
import { DIGITOS_DE_LA_CLAVE, digitosDe, ultimos10 } from '@/lib/texto/telefono'
export { digitosDe, ultimos10 }

/** Una lista de prueba más larga ya no es una prueba. */
export const TOPE_NUMEROS_DE_PRUEBA = 20

const DIGITOS_MINIMOS = DIGITOS_DE_LA_CLAVE
/** El largo máximo de un número E.164. */
const DIGITOS_MAXIMOS = 15

export function validarNumeroDePrueba(
  texto: string,
): { ok: true; digitos: string } | { ok: false; problema: 'NUMERO_CORTO' | 'NUMERO_LARGO' } {
  const digitos = digitosDe(texto)
  if (digitos.length < DIGITOS_MINIMOS) return { ok: false, problema: 'NUMERO_CORTO' }
  if (digitos.length > DIGITOS_MAXIMOS) return { ok: false, problema: 'NUMERO_LARGO' }
  return { ok: true, digitos }
}

/**
 * Dos números son el mismo teléfono si sus últimos 10 dígitos coinciden.
 * Menos de 10 dígitos no coincide con nada: sin código de área no hay forma de
 * saber de qué número se habla, y "4455" no puede terminar habilitando a todos
 * los que terminen así.
 */
export function coinciden(a: string, b: string): boolean {
  const da = digitosDe(a)
  const db = digitosDe(b)
  if (da.length < DIGITOS_MINIMOS || db.length < DIGITOS_MINIMOS) return false
  return ultimos10(da) === ultimos10(db)
}

export function coincideConAlguno(waId: string, numeros: readonly string[]): boolean {
  return numeros.some((n) => coinciden(waId, n))
}

/**
 * Cómo se ve un número en la pantalla: seis dígitos, guion, cuatro. No se parte
 * el código de área porque su largo varía (11, 351, 2966): un espacio fijo
 * después del segundo dígito quedaría mal puesto fuera de Buenos Aires.
 */
export function mostrarNumeroDePrueba(digitos: string): string {
  const u = ultimos10(digitos)
  return `${u.slice(0, 6)}-${u.slice(6)}`
}
