import * as React from "react"

// 1024 y no los 768 que trae shadcn por default, y la pregunta que contesta es
// UNA SOLA: ¿el sidebar es un panel flotante? Abajo de este ancho el sidebar se
// renderiza como `Sheet` (components/ui/sidebar.tsx) y no ocupa nada en el
// flujo; a partir de acá son 248 px de columna. Por eso el Topbar tiene que
// mostrar la hamburguesa abajo del corte: es el único camino a la navegación.
//
// EXPORTADA porque el mismo número gobierna el `lg:` de Tailwind en todo el
// shell: afirmar el valor desde un test que lea el fuente probaría el archivo
// y no el comportamiento, así que los casos lo importan de acá (el ejemplo
// vivo es components/shell/encabezado.test.tsx:199). Ver
// docs/superpowers/specs/2026-08-26-movil-design.md §1.
//
// LO QUE ESTE NÚMERO YA NO DECIDE, y es la corrección del 2026-09-07: si en
// /vender entran las dos columnas. Ese cálculo vivía acá y estaba mal por dos
// motivos —le faltaban el padding del cuerpo y el gap de la fila, y le
// descontaba los 248 del sidebar también abajo de 1024, donde el sidebar es un
// Sheet—. La consecuencia era que el corte quedaba puesto justo donde el
// espacio EMPEORA: un píxel más de ventana le sacaba 267 px al cuerpo. (Ese
// 267 es la cuenta del ANTES, con el padding del cuerpo todavía atado al
// viewport —`px-[14px]`/`lg:p-6`—; rehecha sobre el código de hoy, donde el
// padding también cambia con el contenedor, da 247. Se deja el original
// porque es el que describe el defecto.) Esa pregunta la contesta ahora
// hooks/use-dos-columnas.ts, midiendo el contenedor.
export const MOBILE_BREAKPOINT = 1024

// Reescrito respecto de lo que trae `npx shadcn add sidebar`: el original
// hacía `setState` síncrono adentro de un useEffect (para fijar el valor
// inicial, ya que matchMedia no dispara "change" al montar), lo que provoca
// un segundo render en cada mount — exactamente lo que
// react-hooks/set-state-in-effect existe para evitar. useSyncExternalStore es
// el mecanismo que React documenta para suscribirse a una API del navegador
// sin ese doble render: getSnapshot ya cubre la lectura inicial, así que no
// hace falta el setState de arranque que tenía el useEffect.
function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

// El servidor no tiene innerWidth: asumir "no es mobile" es lo mismo que
// hacía el `undefined` original una vez pasado por `!!` en el return.
function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
