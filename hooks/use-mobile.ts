import * as React from "react"

const MOBILE_BREAKPOINT = 768

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
