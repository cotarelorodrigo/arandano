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

/**
 * La composición que produce `scripts/sembrar-ventas-dev.mts`: dólares en dos
 * de los cuatro medios. Es la forma normal de un local que toma dólares, y la
 * que destapó que el importe desaparecía de las barras sin ellos.
 */
const MIXTO: Composicion = {
  barras: [
    { medio: 'EFECTIVO', ars: '484189', usd: '870000', total: '1354189' },
    { medio: 'TARJETA_CREDITO', ars: '1012499', usd: '0', total: '1012499' },
    { medio: 'TRANSFERENCIA', ars: '176250', usd: '72500', total: '248750' },
    { medio: 'TARJETA_DEBITO', ars: '13400', usd: '0', total: '13400' },
  ],
  total: '2628838',
  hayDolares: true,
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

  it('imprime el importe de TODA barra, también las cobradas sin un dólar', () => {
    // El hallazgo de la review, y el peor de los seis. recharts no emite
    // rectángulo para un punto de valor 0, y sin rectángulo tampoco emite su
    // label: con el importe colgado sólo del tramo de dólares, de estas cuatro
    // barras se imprimían DOS. No es un borde —es un local que toma dólares en
    // efectivo y transferencia— y no es cosmético: la excepción de contraste de
    // --chart-2 se acepta declarando que cada barra lleva su importe al lado.
    //
    // Se afirma sobre los <tspan> del SVG y NO sobre el marcado entero, y eso
    // no es precisión decorativa: los cuatro importes están además en la tabla
    // accesible del mismo componente, así que un `toContain` sobre todo el HTML
    // da verde aunque el gráfico no dibuje un solo número. La primera versión
    // de este caso hacía exactamente eso — comprobado rompiendo el arreglo a
    // propósito y viendo que pasaba igual.
    const enElSvg = [...montar(MIXTO).matchAll(/<tspan[^>]*>([^<]+)<\/tspan>/g)].map(
      (m) => m[1],
    )
    for (const importe of ['1.354.189,00', '1.012.499,00', '248.750,00', '13.400,00']) {
      expect(
        enElSvg.some((t) => t.includes(importe)),
        `el gráfico no imprime ${importe}; sólo dibuja ${JSON.stringify(enElSvg)}`,
      ).toBe(true)
    }
  })

  it('no deja una parada de tab adentro del aria-hidden', () => {
    // recharts 3 le pone al SVG `role="application"` y `tabindex="0"` por
    // default —no hace falta `accessibilityLayer`—, y este SVG vive adentro de
    // un aria-hidden: es la violación aria-hidden-focus de axe, y en la
    // práctica una parada de tab invisible entre "Filtrar" y el listado.
    expect(montar(MIXTO)).not.toContain('tabindex="0"')
  })

  it('reserva a la derecha lo que el importe más largo necesita', () => {
    // Con margen fijo, `$ 1.354.189,00` terminaba pasado el borde del SVG, que
    // recorta lo que se sale. El margen se calcula sobre el rótulo real.
    const html = montar(MIXTO)
    const ancho = Number(html.match(/class="recharts-surface" width="(\d+)"/)?.[1])
    const equis = [...html.matchAll(/<tspan x="([\d.]+)"[^>]*>\$/g)].map((m) => Number(m[1]))
    expect(equis.length).toBeGreaterThan(0)
    for (const x of equis) {
      // 14 caracteres a ~6.6 px es el largo de "$ 1.354.189,00".
      expect(x + 14 * 6.6).toBeLessThanOrEqual(ancho)
    }
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
