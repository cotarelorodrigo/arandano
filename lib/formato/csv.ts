/**
 * El escapado RFC 4180 compartido por los CSV que exporta la aplicación.
 *
 * Vivía duplicado, byte a byte, en `app/(app)/inventario/acciones.ts` (el
 * historial de un artículo) y en el CSV de ventas del dashboard —Important 1
 * de la review de Task 12 del ciclo del dashboard—: dos implementaciones de
 * la misma regla de escapado son exactamente la clase de bug que este repo ya
 * pagó (el selector de categoría duplicado entre el alta y la ficha de
 * artículo, CLAUDE.md, 2026-08-28) — alguien endurece el escapado en una
 * export y la otra sigue rompiendo filas en silencio. Un solo lugar, y las
 * dos exports lo importan.
 */

/**
 * Un apóstrofe adelante si el valor arranca con `=`, `+`, `-` o `@`: sin él,
 * Excel y Google Sheets abren esos cuatro caracteres iniciales como el
 * comienzo de una fórmula en vez de como texto (inyección de fórmulas, ver
 * la guía de OWASP sobre CSV injection). No es un caso de laboratorio: una
 * nota o un nombre cargado así alcanza para dispararlo en cuanto esa fila
 * entra a cualquiera de los dos CSV que usan este módulo — no hace falta una
 * nota manipulada a propósito. El apóstrofe fuerza texto sin mostrarse en la
 * celda al abrirla en una planilla, que es como Excel y Sheets leen un CSV
 * (no sólo cómo se tipea a mano).
 */
function neutralizarFormula(valor: string): string {
  return /^[=+\-@]/.test(valor) ? `'${valor}` : valor
}

/**
 * Comillas dobles si el valor trae coma, comilla o salto de línea (regla
 * estándar de CSV, RFC 4180); las comillas internas se duplican al doblarlas.
 *
 * Sin esto, una nota o un nombre de cliente con una sola coma —"Pérez, Ana",
 * el estilo real con el que se carga un cliente— alcanza para que la fila se
 * parta en dos al abrirla en una planilla, silenciosamente: ninguna
 * herramienta avisa "esto estaba mal separado", el importe simplemente cae
 * en la columna de al lado.
 */
function celdaCsv(valor: string): string {
  const segura = neutralizarFormula(valor)
  return /[",\r\n]/.test(segura) ? `"${segura.replace(/"/g, '""')}"` : segura
}

/** Una fila de CSV, cada campo escapado por `celdaCsv`. */
export function filaCsv(campos: string[]): string {
  return campos.map(celdaCsv).join(',')
}
