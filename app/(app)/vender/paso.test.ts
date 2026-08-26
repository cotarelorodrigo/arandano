import { describe, it, expect } from 'vitest'
import { pasoDeUrl, urlConPaso } from './paso'

// El hook usePasoDeCobro no se testea acá: no hay jsdom en este repo (se sacó
// a propósito en el ciclo de /ventas) y no se reintroduce por un solo hook.
// Las dos funciones puras SÍ son testeables sin DOM, y son las que cargan
// toda la lógica: el hook es apenas un `useState` + dos `pushState` + un
// listener de `popstate` alrededor de ellas.

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
