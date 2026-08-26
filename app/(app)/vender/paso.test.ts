import { describe, it, expect, afterEach } from 'vitest'
import { navegarAlPaso, pasoDeUrl, urlConPaso } from './paso'

// El hook usePasoDeCobro no se testea acá: no hay jsdom en este repo (se sacó
// a propósito en el ciclo de /ventas) y no se reintroduce por un solo hook.
// Las dos funciones puras SÍ son testeables sin DOM, y son las que cargan
// toda la lógica: el hook es apenas un `useSyncExternalStore` + las
// transiciones + un listener de `popstate` alrededor de ellas. `navegarAlPaso`
// —la transición en sí— se ejercita más abajo con un doble de `window`.

describe('pasoDeUrl', () => {
  it('lee ?paso=cobro como el paso de cobro', () => {
    expect(pasoDeUrl('?paso=cobro')).toBe('cobro')
  })

  it('cualquier otro valor de ?paso cae en carrito', () => {
    expect(pasoDeUrl('?paso=cualquiera')).toBe('carrito')
  })

  it('sin query string cae en carrito', () => {
    expect(pasoDeUrl('')).toBe('carrito')
  })

  it('un query string sin el parámetro paso cae en carrito', () => {
    expect(pasoDeUrl('?q=x')).toBe('carrito')
  })
})

describe('urlConPaso', () => {
  it('conserva los parámetros existentes y agrega paso=cobro', () => {
    expect(urlConPaso('/vender?q=iph', 'cobro')).toBe('/vender?q=iph&paso=cobro')
  })

  it('vuelve a carrito SACA el parámetro paso en vez de vaciarlo', () => {
    expect(urlConPaso('/vender?q=iph&paso=cobro', 'carrito')).toBe('/vender?q=iph')
  })
})

// --- Las dos vueltas al carrito, y por qué no son la misma ---
//
// `navegarAlPaso` SÍ se puede ejercitar sin jsdom: lo único que toca del
// navegador son `window.location` y `window.history`, dos objetos que este
// bloque reemplaza por un doble de mano. No es reintroducir un DOM —no hay
// documento, ni elementos, ni eventos—: es inyectar las dos propiedades que la
// función lee, que es lo que la vuelve testeable de verdad en vez de por
// lectura del fuente.
describe('navegarAlPaso', () => {
  const original = globalThis.window

  function fingirNavegador(url: string) {
    const historial = {
      empujadas: [] as string[],
      reemplazadas: [] as string[],
    }
    const { pathname, search } = new URL(url, 'http://localhost')
    globalThis.window = {
      location: { pathname, search },
      history: {
        pushState: (_e: unknown, _t: string, u: string) => historial.empujadas.push(u),
        replaceState: (_e: unknown, _t: string, u: string) => historial.reemplazadas.push(u),
      },
    } as unknown as typeof globalThis.window
    return historial
  }

  afterEach(() => {
    globalThis.window = original
  })

  it('ir al cobro es un gesto de la persona: deja su entrada en el historial', () => {
    const historial = fingirNavegador('/vender?q=iph')
    navegarAlPaso('cobro', 'gesto')
    expect(historial.empujadas).toEqual(['/vender?q=iph&paso=cobro'])
    expect(historial.reemplazadas).toEqual([])
  })

  it('la flecha de volver también es un gesto: deja su entrada', () => {
    const historial = fingirNavegador('/vender?q=iph&paso=cobro')
    navegarAlPaso('carrito', 'gesto')
    expect(historial.empujadas).toEqual(['/vender?q=iph'])
    expect(historial.reemplazadas).toEqual([])
  })

  // EL CASO QUE IMPORTA. La vuelta al carrito de después de cobrar no la pidió
  // nadie: es la consecuencia de que la venta terminó. Si dejara su propia
  // entrada, tocar Atrás devolvería a un cobro YA CONSUMADO —con
  // `ventaProcesada` todavía seteado, así que el efecto volvería a sacar de
  // ahí a la persona y a empujar otra entrada—, y el gesto de volver quedaría
  // muerto en la ventana entre cobrar y escanear el artículo siguiente. En un
  // mostrador eso es después de CADA venta.
  it('la vuelta de después de cobrar es una consecuencia: reemplaza en vez de empujar', () => {
    const historial = fingirNavegador('/vender?q=iph&paso=cobro')
    navegarAlPaso('carrito', 'consecuencia')
    expect(historial.reemplazadas).toEqual(['/vender?q=iph'])
    expect(
      historial.empujadas,
      'una entrada de más acá deja el botón Atrás sordo después de cada venta',
    ).toEqual([])
  })
})
