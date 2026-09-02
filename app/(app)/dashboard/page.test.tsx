import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Tile, ChipDeDelta, SegmentadoDeRango, monedaEfectiva } from './page'
import { SelectorDeMoneda } from './paneles'

describe('el tile de marca', () => {
  it('en pesos: el número grande y el dólar al pie', () => {
    const html = renderToStaticMarkup(
      <Tile rotulo="TOTAL DEL PERÍODO" valor="$ 8.412.900"
        pie="US$ 4.120 aparte" delta={{ porcentaje: 18.4, sube: true }} marca />,
    )
    expect(html).toContain('$ 8.412.900')
    expect(html).toContain('US$ 4.120 aparte')
    expect(html).toContain('+18,4%')
  })

  // Sin esta regla, un local que carga y cobra TODO su catálogo en dólares
  // —el único que hoy usa esa feature— abriría el dashboard con "$ 0,00" de
  // titular.
  it('sin pesos cobrados, el número grande es el dólar y no hay pie', () => {
    const html = renderToStaticMarkup(
      <Tile rotulo="TOTAL DEL PERÍODO" valor="US$ 4.120" marca />,
    )
    expect(html).toContain('US$ 4.120')
    expect(html).not.toContain('$ 0,00')
  })
})

describe('el chip de delta', () => {
  it('el signo decide el ícono y el color', () => {
    expect(renderToStaticMarkup(<ChipDeDelta delta={{ porcentaje: 9.1, sube: true }} />))
      .toContain('+9,1%')
    expect(renderToStaticMarkup(<ChipDeDelta delta={{ porcentaje: -2.3, sube: false }} />))
      // Menos tipográfico (U+2212), no guion: es lo que dibuja la maqueta.
      .toContain('−2,3%')
  })

  it('sin delta no dibuja nada', () => {
    expect(renderToStaticMarkup(<ChipDeDelta delta={null} />)).toBe('')
  })
})

describe('el segmentado de rango', () => {
  it('marca el activo y linkea los otros tres', () => {
    const html = renderToStaticMarkup(
      <SegmentadoDeRango activo="estemes" href={(r) => `/dashboard?rango=${r}`} />,
    )
    expect(html).toContain('Este año')
    expect(html).toContain('aria-current="page"')
    // El activo no se linkea a sí mismo con el parámetro puesto de más.
    expect(html).toContain('/dashboard?rango=hoy')
  })
})

// Critical de la review de Task 11: `hrefRango` arrastra `?moneda`, así que
// desde `/dashboard?moneda=usd` en un mes con dólares, un click en "Hoy" —un
// día sin ninguno— dejaba `hayDolares` en `false` para ese período: el
// selector no se dibujaba, y no quedaba en pantalla ningún control para
// volver a pesos mientras los tiles seguían mostrando pesos reales.
// `monedaEfectiva()` es el fallback: cae a la que sí tuvo actividad, sin
// tocar `?moneda` (la pedida, la que preserva el resto de la navegación).
describe('monedaEfectiva: los paneles nunca se quedan con la pila vacía', () => {
  it('?moneda=usd en un período sin dólares cae a "ars"', () => {
    expect(monedaEfectiva('usd', /* huboEnPesos */ true, /* huboEnDolares */ false)).toBe('ars')
  })

  it('un período que sólo tuvo dólares cae a "usd" aunque `?moneda` siga en su default', () => {
    expect(monedaEfectiva('ars', /* huboEnPesos */ false, /* huboEnDolares */ true)).toBe('usd')
  })

  it('si la moneda pedida ya tuvo actividad, no cambia nada', () => {
    expect(monedaEfectiva('usd', true, true)).toBe('usd')
    expect(monedaEfectiva('ars', true, true)).toBe('ars')
  })

  // Sin actividad en NINGUNA moneda —tenant nuevo, período sin ventas—, la
  // función igual cae a la otra: mismo comportamiento que ya tiene
  // `monedaEfectiva` en /ventas (nunca comparó contra la otra pila, sólo
  // preguntó si la pedida estaba vacía). Es inofensivo acá: con las dos
  // vacías, `hayDolares` también da `false`, el selector no se dibuja, y
  // cualquiera de las dos monedas que termine "mostrándose" pinta el mismo
  // "todavía no se vendió nada" en los tres paneles — no hay nada visible
  // que la elección pueda contradecir.
  it('sin actividad en ninguna moneda, cae igual —inofensivo: no hay selector ni datos que contradecir', () => {
    expect(monedaEfectiva('ars', false, false)).toBe('usd')
    expect(monedaEfectiva('usd', false, false)).toBe('ars')
  })

  // La prueba de que el Critical queda resuelto de verdad: sin el fallback,
  // este escenario deja a la persona sin selector Y sin datos. Con él, el
  // selector se dibuja (hayDolares del período sigue en `false`... pero acá
  // lo que importa es que `monedaMostrada` cae a 'ars', que es la moneda con
  // datos) y el panel de medios muestra la plata real en vez de "sin datos".
  it('con la moneda efectiva, el panel de medios resuelve a la pila que sí tiene barras', () => {
    const huboEnPesos = true
    const huboEnDolares = false
    const monedaMostrada = monedaEfectiva('usd', huboEnPesos, huboEnDolares)
    expect(monedaMostrada).toBe('ars')
    // Y el selector, si se dibujara, resaltaría la que está en pantalla —no
    // la pedida—: pasarle `moneda` en vez de `monedaMostrada` marcaría "US$"
    // como activo mientras el panel de al lado muestra pesos.
    const html = renderToStaticMarkup(
      <SelectorDeMoneda hayDolares moneda={monedaMostrada} href={(m) => `/dashboard?moneda=${m}`} />,
    )
    const links = html.match(/<a [^>]*>[^<]*<\/a>/g) ?? []
    const linkArs = links.find((l) => l.endsWith('>$</a>'))
    const linkUsd = links.find((l) => l.endsWith('>US$</a>'))
    expect(linkArs, `no se encontró el link de $ en: ${html}`).toContain('aria-current="page"')
    expect(linkUsd, `no se encontró el link de US$ en: ${html}`).not.toContain('aria-current')
  })
})
