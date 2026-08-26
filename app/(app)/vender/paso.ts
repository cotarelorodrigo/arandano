import { useCallback, useSyncExternalStore } from 'react'

// El paso de cobro de /vender se maneja en la URL (?paso=cobro) pero SIN
// pasar por el router de Next: ni `router.push` ni `useSearchParams`. Los dos
// disparan una navegación de Next -- el server component de la ruta vuelve a
// renderizar -- y el carrito vive en el estado de cliente de PuntoDeVenta:
// un remonte a mitad de una venta se lo llevaría puesto. `pushState` cambia
// la URL sin ese ciclo -- Next lo documenta como la forma soportada de
// actualizar search params sin navegar.

export type Paso = 'carrito' | 'cobro'

/**
 * Lee el paso desde un query string (`location.search`, con o sin el `?`
 * inicial). Cualquier valor que no sea exactamente 'cobro' -- ausente, vacío,
 * o inesperado -- cae en 'carrito': es el paso por default, el que
 * corresponde a entrar a /vender de cero.
 */
export function pasoDeUrl(busqueda: string): Paso {
  const parametros = new URLSearchParams(busqueda)
  return parametros.get('paso') === 'cobro' ? 'cobro' : 'carrito'
}

/**
 * Arma la URL (path + query) que corresponde al paso dado, a partir de la
 * URL actual. Conserva el resto de los parámetros (como `q`, el buscador).
 * Volver a 'carrito' SACA el parámetro `paso` en vez de dejarlo vacío:
 * '/vender' y '/vender?paso=' no son la misma URL para quien la comparte o
 * refresca, y el estado por default no debería necesitar ningún parámetro
 * para expresarse.
 */
export function urlConPaso(actual: string, paso: Paso): string {
  // Base ficticia: `actual` es un path relativo ("/vender?q=iph"), no una URL
  // absoluta, y el constructor `URL` la exige para poder parsear. Se descarta
  // enseguida -- sólo se devuelven pathname + search.
  const url = new URL(actual, 'http://localhost')
  if (paso === 'cobro') {
    url.searchParams.set('paso', 'cobro')
  } else {
    url.searchParams.delete('paso')
  }
  return `${url.pathname}${url.search}`
}

// A nivel de módulo, no de hook: `pushState` NO dispara ningún evento --ni
// siquiera `popstate`, que es sólo para Atrás/Adelante del historial-- así
// que sin este `Set` las propias transiciones (irACobro/volverAlCarrito)
// cambiarían la URL sin que ningún componente se enterara de su propio
// cambio. Cada `subscribe` (uno por componente montado que use el hook)
// agrega su callback acá; notificar recorre el `Set` y dispara un re-render
// de cada uno vía `useSyncExternalStore`.
const escuchas = new Set<() => void>()

function notificarCambioDePaso() {
  for (const escucha of escuchas) escucha()
}

// Mismo mecanismo que ya usa hooks/use-mobile.ts para el mismo problema:
// useSyncExternalStore es lo que React documenta para suscribirse a una API
// del navegador sin el doble render de un `setState` adentro de un
// `useEffect`, y separa la lectura del servidor (getServerSnapshot) de la
// lectura real del navegador (getSnapshot) -- así el primer render del
// cliente, durante la hidratación, coincide con lo que mandó el servidor en
// vez de leer `window` antes de tiempo y desincronizarse del HTML recibido.
function subscribe(callback: () => void) {
  escuchas.add(callback)
  window.addEventListener('popstate', callback)
  return () => {
    escuchas.delete(callback)
    window.removeEventListener('popstate', callback)
  }
}

function getSnapshot(): Paso {
  return pasoDeUrl(window.location.search)
}

// El servidor no tiene `window`: 'carrito' es además el paso correcto para
// arrancar la pantalla, así que no hace falta leer nada.
function getServerSnapshot(): Paso {
  return 'carrito'
}

export function usePasoDeCobro() {
  const paso = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const irACobro = useCallback(() => {
    window.history.pushState(null, '', urlConPaso(window.location.pathname + window.location.search, 'cobro'))
    notificarCambioDePaso()
  }, [])

  const volverAlCarrito = useCallback(() => {
    window.history.pushState(null, '', urlConPaso(window.location.pathname + window.location.search, 'carrito'))
    notificarCambioDePaso()
  }, [])

  return { paso, irACobro, volverAlCarrito }
}
