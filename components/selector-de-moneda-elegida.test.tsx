import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SelectorDeMonedaElegida } from './selector-de-moneda-elegida'

// Compartido por "Cómo entró la plata" de /ventas y los cuatro paneles de
// /dashboard (review final de rama — antes cada pantalla tenía su propia
// copia del mismo marcado, y ya habían divergido: /ventas seguía con un
// `<a>` pelado y /dashboard ya usaba `<Link>`).
describe('el selector de moneda', () => {
  // La regla del producto: un local que no usa dólares no ve NINGUNA
  // diferencia con lo que ya conoce.
  it('no se dibuja si el período tuvo una sola moneda', () => {
    expect(renderToStaticMarkup(
      <SelectorDeMonedaElegida hayDolares={false} moneda="ars" href={(m) => `?moneda=${m}`} />,
    )).toBe('')
  })

  it('con las dos monedas ofrece las dos', () => {
    const html = renderToStaticMarkup(
      <SelectorDeMonedaElegida hayDolares moneda="ars" href={(m) => `?moneda=${m}`} />,
    )
    expect(html).toContain('US$')
    expect(html).toContain('?moneda=usd')
  })

  it('marca la moneda activa con aria-current, no la otra', () => {
    const html = renderToStaticMarkup(
      <SelectorDeMonedaElegida hayDolares moneda="usd" href={(m) => `?moneda=${m}`} />,
    )
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    // El activo aparece antes del texto "US$" y no antes de "$": es la pieza
    // que un `toContain('aria-current="page"')` suelto no puede distinguir.
    const activo = html.match(/aria-current="page"[^>]*>([^<]*)</)
    expect(activo?.[1]).toBe('US$')
  })

  // <Link> y no un control de cliente: el estado vive en la URL, así que el
  // selector funciona sin JavaScript. Un `<a>` con `onClick` no lo cumpliría.
  it('son links de verdad al href que arma el llamador', () => {
    const html = renderToStaticMarkup(
      <SelectorDeMonedaElegida hayDolares moneda="ars" href={(m) => `/dashboard?moneda=${m}`} />,
    )
    expect(html).toContain('href="/dashboard?moneda=ars"')
    expect(html).toContain('href="/dashboard?moneda=usd"')
  })
})
