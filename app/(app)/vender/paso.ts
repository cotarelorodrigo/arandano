import { useCallback, useEffect, useState } from 'react'

// El paso de cobro de /vender se maneja en la URL (?paso=cobro) pero SIN
// pasar por el router de Next: ni `router.push` ni `useSearchParams`. Los dos
// disparan una navegación de Next -- el server component de la ruta vuelve a
// renderizar -- y el carrito vive en el estado de cliente de PuntoDeVenta:
// un remonte a mitad de una venta se lo llevaría puesto. `pushState` cambia
// la URL sin ese ciclo -- Next lo documenta como la forma soportada de
// actualizar search params sin navegar --, y el `popstate` (el botón Atrás
// del teléfono) es lo único que necesita un listener propio, porque
// `pushState` no dispara ningún evento por sí solo.

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

export function usePasoDeCobro() {
  // Perezoso: el inicializador sólo corre una vez, al montar -- no en cada
  // render.
  const [paso, setPaso] = useState<Paso>(() => pasoDeUrl(window.location.search))

  useEffect(() => {
    const alNavegarConAtras = () => setPaso(pasoDeUrl(window.location.search))
    window.addEventListener('popstate', alNavegarConAtras)
    return () => window.removeEventListener('popstate', alNavegarConAtras)
  }, [])

  const irACobro = useCallback(() => {
    window.history.pushState(null, '', urlConPaso(window.location.pathname + window.location.search, 'cobro'))
    setPaso('cobro')
  }, [])

  const volverAlCarrito = useCallback(() => {
    window.history.pushState(null, '', urlConPaso(window.location.pathname + window.location.search, 'carrito'))
    setPaso('carrito')
  }, [])

  return { paso, irACobro, volverAlCarrito }
}
