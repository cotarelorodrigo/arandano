import { useCallback, useSyncExternalStore } from 'react'

// El paso de cobro de /vender se maneja en la URL (?paso=cobro) pero SIN
// pasar por el router de Next: ni `router.push` ni `useSearchParams`. Los dos
// disparan una navegación de Next -- el server component de la ruta vuelve a
// renderizar -- y el carrito vive en el estado de cliente de PuntoDeVenta:
// un remonte a mitad de una venta se lo llevaría puesto. `pushState` y
// `replaceState` cambian la URL sin ese ciclo -- Next lo documenta como la
// forma soportada de actualizar search params sin navegar. Cuál de los dos
// corresponde en cada caso lo decide `MotivoDelPaso`, más abajo.

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

// A nivel de módulo, no de hook: `pushState` (y `replaceState`) NO disparan
// ningún evento --ni siquiera `popstate`, que es sólo para Atrás/Adelante del
// historial-- así que sin este `Set` las propias transiciones
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

/**
 * Por qué se cambia de paso, que es lo que decide qué le pasa al historial.
 *
 * - `gesto`: la persona lo pidió —apretó Cobrar, o la flecha de volver—, así
 *   que le corresponde su propia entrada y el botón Atrás del teléfono tiene
 *   que poder deshacerlo. Es lo que hace que la flecha de la maqueta y el
 *   Atrás del navegador hagan lo mismo, que fue el motivo de poner el paso en
 *   la URL en vez de en estado interno.
 * - `consecuencia`: nadie lo pidió; pasó porque la venta terminó de cobrarse.
 *   Una entrada acá le rompe el Atrás a la persona DESPUÉS DE CADA VENTA:
 *   volvería a `?paso=cobro` con la venta ya cobrada, y como `ventaProcesada`
 *   sigue seteado —no se puede limpiar, gatea el cartel de "Venta #N cobrada"
 *   en punto-de-venta.tsx—, el efecto la sacaría de ahí otra vez empujando
 *   otra entrada. El gesto queda muerto. `replaceState` no deja nada que
 *   deshacer.
 */
export type MotivoDelPaso = 'gesto' | 'consecuencia'

/**
 * Cambia el paso en la URL. Exportada —además de usarse desde el hook— para
 * que `paso.test.ts` la ejercite de verdad: lo único que toca del navegador
 * son `window.location` y `window.history`, dos objetos que un test puede
 * reemplazar por un doble sin necesitar jsdom.
 */
export function navegarAlPaso(paso: Paso, motivo: MotivoDelPaso) {
  const url = urlConPaso(window.location.pathname + window.location.search, paso)
  if (motivo === 'consecuencia') window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
  notificarCambioDePaso()
}

export function usePasoDeCobro() {
  const paso = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const irACobro = useCallback(() => navegarAlPaso('cobro', 'gesto'), [])
  const volverAlCarrito = useCallback(() => navegarAlPaso('carrito', 'gesto'), [])
  /** La vuelta de después de cobrar — ver `MotivoDelPaso`. */
  const descartarElCobro = useCallback(() => navegarAlPaso('carrito', 'consecuencia'), [])

  return { paso, irACobro, volverAlCarrito, descartarElCobro }
}
