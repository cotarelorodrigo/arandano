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

  function fingirNavegador(url: string, estado: unknown = null) {
    const historial = {
      empujadas: [] as { url: string; estado: unknown }[],
      reemplazadas: [] as string[],
      atras: 0,
    }
    const { pathname, search } = new URL(url, 'http://localhost')
    globalThis.window = {
      location: { pathname, search },
      history: {
        state: estado,
        pushState: (e: unknown, _t: string, u: string) => historial.empujadas.push({ url: u, estado: e }),
        replaceState: (_e: unknown, _t: string, u: string) => historial.reemplazadas.push(u),
        back: () => {
          historial.atras += 1
        },
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
    expect(historial.empujadas.map((e) => e.url)).toEqual(['/vender?q=iph&paso=cobro'])
    expect(historial.reemplazadas).toEqual([])
    expect(historial.atras).toBe(0)
  })

  // La entrada que empujamos va MARCADA, y esa marca es lo único que después
  // distingue "esta entrada la puse yo" de "acá aterrizó alguien con una URL
  // tipeada o compartida". Sin ella no se puede consumir nada sin arriesgarse
  // a sacar a la persona de la aplicación.
  it('la entrada que empuja un gesto queda marcada como nuestra', () => {
    const historial = fingirNavegador('/vender')
    navegarAlPaso('cobro', 'gesto')
    expect(historial.empujadas[0].estado).toMatchObject({ arandanoPasoDeCobro: true })
  })

  it('la flecha de volver también es un gesto: deja su entrada', () => {
    const historial = fingirNavegador('/vender?q=iph&paso=cobro')
    navegarAlPaso('carrito', 'gesto')
    expect(historial.empujadas.map((e) => e.url)).toEqual(['/vender?q=iph'])
    expect(historial.reemplazadas).toEqual([])
    expect(historial.atras).toBe(0)
  })

  // EL CASO QUE IMPORTA, y el que resuelve el defecto acumulativo. La vuelta de
  // después de cobrar no la pidió nadie: es la consecuencia de que la venta
  // terminó. Si empuja, tocar Atrás devuelve a un cobro YA CONSUMADO; si
  // reemplaza, no devuelve a ningún lado pero deja una entrada duplicada por
  // venta, y con 50 ventas en un turno hacen falta 50 toques de Atrás para que
  // el gesto haga algo visible. Consumir la entrada propia con `back()` es lo
  // único que restaura el historial exacto de antes del cobro.
  it('la vuelta de después de cobrar consume la entrada propia en vez de empujar otra', () => {
    const historial = fingirNavegador('/vender?q=iph&paso=cobro', { arandanoPasoDeCobro: true })
    navegarAlPaso('carrito', 'consecuencia')
    expect(historial.atras, 'la entrada propia se consume, no se duplica').toBe(1)
    expect(historial.empujadas).toEqual([])
    expect(historial.reemplazadas).toEqual([])
  })

  // La otra rama, la que hace que consumir sea seguro: alguien que entró
  // directo a /vender?paso=cobro —una URL tipeada, o compartida— tiene arriba
  // una entrada que NO empujamos nosotros. Un `back()` ahí lo sacaría de la
  // aplicación, así que ahí se reemplaza.
  it('si la entrada de arriba no es nuestra, reemplaza en vez de consumir', () => {
    const historial = fingirNavegador('/vender?q=iph&paso=cobro')
    navegarAlPaso('carrito', 'consecuencia')
    expect(historial.reemplazadas).toEqual(['/vender?q=iph'])
    expect(historial.atras, 'nunca un back() sobre una entrada que no es nuestra').toBe(0)
    expect(historial.empujadas).toEqual([])
  })

  // Un estado de historial que existe pero es de otro (el de Next, por
  // ejemplo) tampoco cuenta como nuestro.
  it('un estado ajeno no se confunde con la marca propia', () => {
    const historial = fingirNavegador('/vender?paso=cobro', { __NA: true, tree: ['x'] })
    navegarAlPaso('carrito', 'consecuencia')
    expect(historial.atras).toBe(0)
    expect(historial.reemplazadas).toEqual(['/vender'])
  })
})
