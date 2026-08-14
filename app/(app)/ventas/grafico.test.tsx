// @vitest-environment jsdom
//
// El único archivo del repo que corre en jsdom, y por una razón concreta:
// recharts 3 no dibuja NADA en el servidor. `renderToStaticMarkup` de un
// <BarChart> devuelve un div vacío de 127 caracteres — el SVG lo construye el
// cliente después de medir el contenedor. O sea que las aserciones sobre las
// barras (el separador de 2 px, que es load-bearing: sostiene una excepción de
// contraste declarada en scripts/contraste.mts) no existen fuera de un DOM.
//
// Lo que SÍ se puede afirmar sin DOM —la tabla accesible, que es el camino sin
// JavaScript— se afirma abajo con renderToStaticMarkup, dentro de este mismo
// archivo y a propósito: es la mitad del componente que tiene que sobrevivir a
// que recharts no llegue nunca.
import { describe, it, expect, beforeAll } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GraficoDeMedios } from './grafico'
import type { Composicion } from '@/lib/ventas/medios'

beforeAll(() => {
  // Sin esto React inunda stderr con "not configured to support act(...)".
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const SOLO_PESOS: Composicion = {
  barras: [
    { medio: 'EFECTIVO', ars: '90000', usd: '0', total: '90000' },
    { medio: 'TARJETA_DEBITO', ars: '10000', usd: '0', total: '10000' },
  ],
  total: '100000',
  hayDolares: false,
}

const CON_DOLARES: Composicion = {
  barras: [{ medio: 'EFECTIVO', ars: '90000', usd: '12000', total: '102000' }],
  total: '102000',
  hayDolares: true,
}

function montar(composicion: Composicion): string {
  const div = document.createElement('div')
  document.body.appendChild(div)
  act(() => {
    createRoot(div).render(<GraficoDeMedios composicion={composicion} />)
  })
  return div.innerHTML
}

describe('el gráfico de medios de pago', () => {
  it('dibuja una barra por medio', () => {
    const html = montar(SOLO_PESOS)
    // Dos marcas de datos: una por medio. La clase va con la comilla de cierre
    // pegada a propósito — el className del ChartContainer menciona
    // `recharts-rectangle.recharts-tooltip-cursor` como selector de Tailwind, y
    // sin la comilla este conteo lo estaría contando a él.
    expect(html.match(/class="recharts-rectangle"/g)).toHaveLength(2)
  })

  it('separa los dos tramos de la pila con 2 px del color de la superficie', () => {
    // El separador que sostiene la excepción "--chart-1 sobre --chart-2" de
    // scripts/contraste.mts: los dos tramos dan 2.02 entre sí, y se acepta
    // PORQUE no se tocan. Si esto se borra, esa razón queda en falso.
    const html = montar(CON_DOLARES)
    const conSeparador = html.match(/stroke-width="2"/g) ?? []
    expect(conSeparador.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('stroke="var(--card)"')
  })

  it('rotula los medios en castellano y no con el nombre del enum', () => {
    const html = montar(SOLO_PESOS)
    expect(html).toContain('Débito')
    expect(html).not.toContain('TARJETA_DEBITO')
  })

  it('sin dólares no dibuja leyenda', () => {
    // Una leyenda de un solo ítem no informa nada: repite el título.
    expect(montar(SOLO_PESOS)).not.toContain('Dólares')
  })

  it('con dólares dibuja la leyenda de las dos series', () => {
    const html = montar(CON_DOLARES)
    expect(html).toContain('Pesos')
    expect(html).toContain('Dólares')
  })
})

describe('la tabla accesible', () => {
  // Sin JavaScript el gráfico es un rectángulo vacío. Esta tabla es lo que
  // queda, y además es el "table view" que la excepción de contraste de
  // --chart-2 declara como mitigación. Se afirma sobre el HTML del SERVIDOR
  // justamente porque ese es el escenario que cubre.
  const servidor = (c: Composicion) =>
    renderToStaticMarkup(<GraficoDeMedios composicion={c} />)

  it('lleva los importes al HTML del servidor, sin que recharts dibuje nada', () => {
    const html = servidor(SOLO_PESOS)
    expect(html).toContain('Efectivo')
    // Formateado como el resto de la plata del producto, no en crudo.
    expect(html).toContain('90.000,00')
    expect(html).not.toContain('90000<')
  })

  it('desglosa pesos y dólares cuando los hay', () => {
    const html = servidor(CON_DOLARES)
    expect(html).toContain('12.000,00')
  })

  it('no se le lee dos veces al lector de pantalla', () => {
    // El SVG queda aria-hidden y la tabla es la que se anuncia. Si los dos
    // estuvieran expuestos, un lector de pantalla leería cada importe dos veces.
    expect(servidor(SOLO_PESOS)).toContain('aria-hidden="true"')
  })
})
