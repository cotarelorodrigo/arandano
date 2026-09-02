import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Tile, ChipDeDelta, SegmentadoDeRango } from './page'

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
