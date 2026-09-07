/**
 * ¿Entran las dos columnas de `/vender` —el carrito y el panel de cobro— en el
 * ancho que tiene el cuerpo de la pantalla?
 *
 * ES OTRA PREGUNTA QUE LA DE `hooks/use-mobile.ts`, y por eso es otro módulo.
 * Aquélla contesta "¿el sidebar es un panel flotante?", que es del VIEWPORT y
 * corta en 1024. Ésta contesta "¿hay lugar para dos columnas?", que es del
 * CONTENEDOR — y el viewport no la puede contestar, porque el sidebar parte la
 * relación entre uno y otro en dos regímenes: abajo de 1024 es un `Sheet` y no
 * ocupa nada, a partir de 1024 son 248 px de flujo. Un píxel más de ventana le
 * saca 267 px al cuerpo. Ver
 * docs/superpowers/specs/2026-09-07-corte-por-contenedor-en-vender-design.md.
 */

/**
 * 48 del `p-6` del cuerpo + 392 (el mínimo del carrito que declara
 * `hooks/use-mobile.ts`) + 18 del `gap` de la fila + 384 del panel de cobro =
 * 842, redondeado a 850.
 *
 * **El mismo número está en `app/globals.css` como `--container-cobro`**, que
 * es lo que consulta el CSS. No se puede leer de ahí en runtime: está en
 * `@theme inline`, y `inline` significa justamente que el valor se mete en las
 * utilidades en vez de emitirse como custom property. `hooks/use-dos-columnas.test.ts`
 * ata los dos en las dos direcciones.
 */
export const ANCHO_MINIMO_DOS_COLUMNAS = 850

/**
 * El nombre del contenedor, que las variantes usan (`@cobro/venta:`).
 *
 * CON NOMBRE Y NO SIN ÉL: una consulta sin nombre resuelve contra el
 * contenedor más cercano, y `components/ui/card.tsx:28` ya establece uno
 * (`@container/card-header`). `/vender` no usa `CardHeader` hoy, pero el día
 * que lo use, un `@cobro:` adentro pasaría a preguntar por el ancho de un
 * encabezado de card — en silencio, sin ningún error.
 */
export const NOMBRE_DEL_CONTENEDOR = 'venta'

/** Con el ancho justo alcanza: es `>=`, igual que la variante de Tailwind. */
export function hayLugarParaDosColumnas(ancho: number): boolean {
  return ancho >= ANCHO_MINIMO_DOS_COLUMNAS
}
