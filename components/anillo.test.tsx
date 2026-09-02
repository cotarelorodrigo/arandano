import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Anillo, arcosDe } from './anillo'

describe('los arcos del anillo', () => {
  it('el primero arranca arriba y van en sentido horario', () => {
    const [a] = arcosDe([50, 50])
    expect(a.offset).toBe(0)
  })

  it('cada arco arranca donde termina el anterior', () => {
    const arcos = arcosDe([40, 35, 25])
    expect(arcos.map((a) => a.offset)).toEqual([0, 40, 75])
    expect(arcos.map((a) => a.largo)).toEqual([40, 35, 25])
  })

  it('un gajo en cero no dibuja arco', () => {
    expect(arcosDe([100, 0]).length).toBe(1)
  })

  it('sin ningún gajo no dibuja nada', () => {
    expect(arcosDe([])).toEqual([])
  })
})

describe('el anillo se lee sin ver el SVG', () => {
  // display:none sobre un <svg> no lo saca del árbol de accesibilidad de forma
  // confiable, y un anillo sin texto no dice nada: la lista va SIEMPRE, y el
  // SVG va aria-hidden.
  it('lleva una lista accesible con cada gajo y su porcentaje', () => {
    const html = renderToStaticMarkup(
      <Anillo
        gajos={[
          { rotulo: 'Efectivo', monto: '$ 4.038.200', porcentaje: 48 },
          { rotulo: 'Crédito', monto: '$ 673.000', porcentaje: 8 },
        ]}
        centro={{ valor: '$ 8,41 M', rotulo: 'cobrado' }}
      />,
    )
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('Efectivo')
    expect(html).toContain('48%')
    expect(html).toContain('$ 4.038.200')
    expect(html).toContain('$ 8,41 M')
  })
})
