'use client'

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

import * as React from 'react'

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

/**
 * Verdadero mientras el elemento referenciado tenga lugar para las dos
 * columnas. Es la mitad JavaScript de la misma decisión que el CSS toma con
 * `@cobro/venta:`, contra el mismo número.
 *
 * POR QUÉ HACE FALTA UNA MITAD JAVASCRIPT. Casi todo lo resuelve el CSS solo,
 * y es mejor así. Lo que no puede son las cuatro props del `<Encabezado>` que
 * dependen del paso —el título ("Vender" / "Cobro"), el subtítulo con el
 * total, la flecha de volver y `controlMovil`—: son props, no clases, así que
 * ahí hay que preguntar. Si esta pregunta se la hiciéramos al viewport
 * mientras el CSS le pregunta al contenedor, los dos se desincronizarían justo
 * en la banda que este ciclo arregla.
 *
 * `useState(true)` y no `false`: el servidor no tiene ancho que medir, y
 * arrancar en el layout ancho es lo mismo que ya hace hoy el
 * `getServerSnapshot()` de `useIsMobile`. La primera medición real llega en el
 * layout effect, antes de que el navegador pinte.
 */
export function useDosColumnas(ref: React.RefObject<HTMLElement | null>): boolean {
  const [hayLugar, setHayLugar] = React.useState(true)

  React.useLayoutEffect(() => {
    const elemento = ref.current
    if (!elemento) return
    const observador = new ResizeObserver(([entrada]) => {
      // `contentBoxSize` y no `contentRect`: los dos dan el content box —
      // `contentRect` NO incluye padding ni borde, a pesar de lo que sugiere
      // su nombre—, pero `inlineSize` es consciente del modo de escritura, que
      // es exactamente la dimensión que consulta un container query
      // `inline-size`. `contentRect` queda de fallback porque es la propiedad
      // vieja y está en todos lados; en un documento horizontal las dos
      // devuelven el mismo número.
      const ancho = entrada.contentBoxSize?.[0]?.inlineSize ?? entrada.contentRect.width
      setHayLugar(hayLugarParaDosColumnas(ancho))
    })
    observador.observe(elemento)
    return () => observador.disconnect()
  }, [ref])

  return hayLugar
}
