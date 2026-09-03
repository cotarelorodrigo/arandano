import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Anillo, arcosDe, RADIO, GROSOR, LADO } from './anillo'

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

describe('la geometría entra en la caja', () => {
  // El caso que faltaba, y que costó verlo en pantalla: con un grosor mal
  // despejado el trazo se dibujaba fuera del viewBox y el navegador lo
  // recortaba, así que el anillo salía CUADRADO con un agujero redondo. Los
  // cinco casos de arriba pasaban igual — todos miran los arcos (largo y
  // offset), y lo que estaba mal era la caja.
  // Se lee del SVG RENDERIZADO y no de las constantes: `LADO` se deriva de
  // `GROSOR`, así que comparar las dos constantes entre sí no puede fallar
  // nunca. Lo que sí puede volver a pasar —y es lo que pasó— es que alguien
  // escriba un viewBox a mano.
  it('el trazo entra en el viewBox que el SVG realmente declara', () => {
    const html = renderToStaticMarkup(
      <Anillo gajos={[{ rotulo: 'Uno', monto: '$ 1', porcentaje: 100 }]} centro={{ valor: '1', rotulo: 'x' }} />,
    )
    const lado = Number(/viewBox="0 0 ([\d.]+) /.exec(html)?.[1])
    const r = Number(/\br="([\d.]+)"/.exec(html)?.[1])
    const grosor = Number(/stroke-width="([\d.]+)"/.exec(html)?.[1])
    expect(lado, 'no se pudo leer el viewBox del SVG').toBeGreaterThan(0)
    expect(r + grosor / 2).toBeLessThanOrEqual(lado / 2)
  })

  // `innerRadius: 0.62` en design/arandano.pen. Es la proporción que hace que
  // se lea como anillo y no como torta con un punto en el medio.
  it('el hueco mide lo que pide la maqueta', () => {
    const hueco = (RADIO - GROSOR / 2) / (RADIO + GROSOR / 2)
    expect(hueco).toBeCloseTo(0.62, 3)
  })

  // La propiedad de la que depende todo el resto: si la circunferencia mide
  // 100, los porcentajes SON las longitudes y no hay ningún 2πr en el código.
  it('la circunferencia mide 100, que es lo que vuelve innecesario el 2πr', () => {
    expect(2 * Math.PI * RADIO).toBeCloseTo(100, 6)
  })
})
