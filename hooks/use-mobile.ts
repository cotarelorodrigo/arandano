import * as React from "react"

// 1024 y no los 768 que trae shadcn por default: es aritmética, no gusto. En
// escritorio /vender pone en una fila el sidebar de 248, el carrito y el
// panel de cobro de 384. A 768 px de viewport al carrito le quedan apenas
// 136 px — roto hoy, con el md:flex-row que el código ya tiene. A 1024 le
// quedan 392, que es el mínimo que funciona. El costo es que un iPad vertical
// recibe la versión de teléfono: es la respuesta correcta, porque a ese ancho
// la versión de teléfono se ve bien y la de escritorio no. Exportada porque
// el mismo número gobierna el `lg:` de Tailwind en todo el shell, y afirmar
// el valor desde un test que lea el fuente probaría el archivo y no el
// comportamiento. Ver docs/superpowers/specs/2026-08-26-movil-design.md §1.
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
