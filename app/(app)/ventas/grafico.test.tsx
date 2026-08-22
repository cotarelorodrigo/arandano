// Sin '@vitest-environment jsdom': fue el único archivo del repo que lo
// necesitaba, y dejó de necesitarlo con este mismo cambio. La razón vieja era
// que recharts no dibuja nada del lado del servidor —el SVG lo arma el
// cliente después de medir el contenedor—, así que las aserciones sobre las
// barras necesitaban un DOM real. Con las barras reescritas como `Progress`
// de shadcn (un `<div>` con el ancho ya calculado en el servidor), no hay
// nada que medir: `renderToStaticMarkup` alcanza para afirmar todo, igual que
// ya alcanzaba para la tabla accesible de la versión anterior. Si esta
// excepción vuelve a hacer falta algún día, se documenta en los DOS lugares
// otra vez: acá y en vitest.config.mts — a medias es peor que no sacarla,
// porque el próximo lector cree que sigue vigente.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GraficoDeMedios, porcentajesQueSuman100 } from './grafico'
import type { Composicion } from '@/lib/ventas/medios'

const CUATRO_MEDIOS: Composicion = {
  barras: [
    { medio: 'EFECTIVO', ars: '612400', usd: '0', total: '612400' },
    { medio: 'TRANSFERENCIA', ars: '389700', usd: '0', total: '389700' },
    { medio: 'TARJETA_DEBITO', ars: '182400', usd: '0', total: '182400' },
    { medio: 'TARJETA_CREDITO', ars: '100000', usd: '0', total: '100000' },
  ],
  total: '1284500',
  hayDolares: false,
}

const UN_MEDIO: Composicion = {
  barras: [{ medio: 'EFECTIVO', ars: '90000', usd: '12000', total: '102000' }],
  total: '102000',
  hayDolares: true,
}

describe('porcentajesQueSuman100', () => {
  it('reparte enteros que suman exactamente 100', () => {
    // Los mismos montos que la maqueta (design/arandano.pen, nodo `eyqV3`):
    // 48/30/14/8, que además ya suman 100 con el redondeo ingenuo — el caso
    // de abajo es el que de verdad prueba el método del resto mayor.
    const pcts = porcentajesQueSuman100([612400, 389700, 182400, 100000])
    expect(pcts).toEqual([48, 30, 14, 8])
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('también suma 100 cuando el redondeo ingenuo NO daría 100', () => {
    // 1/3 de cada uno: redondeando cada tercio por separado da 33+33+33 = 99,
    // no 100. El resto mayor reparte el punto que falta a una de las tres
    // barras — la prueba de que el método hace algo distinto de
    // Math.round(x) en cada elemento.
    const pcts = porcentajesQueSuman100([1, 1, 1])
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
    // Las tres partes son iguales, así que el punto de más cae en cualquiera
    // — lo que importa es que ninguna quede en 0 ni en 34+.
    expect(pcts.every((p) => p === 33 || p === 34)).toBe(true)
  })

  it('sin total no divide por cero', () => {
    expect(porcentajesQueSuman100([0, 0])).toEqual([0, 0])
    expect(porcentajesQueSuman100([])).toEqual([])
  })
})

describe('el panel de medios de pago', () => {
  it('dibuja una barra por medio, con el monto de cada una', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={CUATRO_MEDIOS} />)
    expect(html).toContain('Efectivo')
    expect(html).toContain('612.400,00')
    expect(html).toContain('Transferencia')
    expect(html).toContain('389.700,00')
    expect(html).toContain('Débito')
    expect(html).toContain('182.400,00')
    expect(html).toContain('Crédito')
    expect(html).toContain('100.000,00')
  })

  it('rotula los medios en castellano y no con el nombre del enum', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={UN_MEDIO} />)
    expect(html).not.toContain('EFECTIVO')
  })

  it('un medio sin pagos no aparece: sólo se dibujan las barras de la composición', () => {
    // componerPorMedio (lib/ventas/composicion.ts) ya excluye los medios sin
    // un solo pago del período — este caso confirma que el componente no
    // agrega de más: con una sola barra en la composición, "Débito" y
    // "Crédito" no tienen ningún texto en el resultado.
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={UN_MEDIO} />)
    expect(html).not.toContain('Débito')
    expect(html).not.toContain('Crédito')
    expect(html).not.toContain('Transferencia')
  })

  it('imprime el porcentaje de cada barra bajo su rótulo', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={CUATRO_MEDIOS} />)
    expect(html).toContain('48% del total')
    expect(html).toContain('30% del total')
    expect(html).toContain('14% del total')
    expect(html).toContain('8% del total')
  })

  it('la nota de la cotización siempre está', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={UN_MEDIO} />)
    expect(html).toContain('Los pagos en dólares están convertidos a la cotización de cada pago.')
  })
})
