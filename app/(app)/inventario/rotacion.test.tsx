import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { agregarVentasPorMes, GraficoDeRotacion } from './rotacion'

// "Ahora" fijo para que los tests no dependan del reloj del sistema: mismo
// criterio que test/ventas.test.ts y sus fechas explícitas.
const AHORA = new Date('2026-08-22T15:00:00Z') // 22/08/2026, 12:00 en Buenos Aires

describe('agregarVentasPorMes', () => {
  it('devuelve 6 meses, terminando en el mes de "ahora"', () => {
    const meses = agregarVentasPorMes([], AHORA)
    expect(meses).toHaveLength(6)
    expect(meses.map((m) => m.clave)).toEqual([
      '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
    ])
    expect(meses.map((m) => m.rotulo)).toEqual(['Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago'])
  })

  // El requisito que el brief pide explícitamente: cero movimientos no puede
  // reventar la agregación — tiene que dar los 6 meses igual, todos en 0.
  it('sin movimientos, no rompe: los 6 meses dan 0 unidades', () => {
    const meses = agregarVentasPorMes([], AHORA)
    expect(meses.every((m) => m.unidades === 0)).toBe(true)
  })

  it('suma el valor absoluto de los deltas de venta del mes', () => {
    const meses = agregarVentasPorMes(
      [
        { delta: '-1', creadoEn: new Date('2026-08-21T17:28:00Z') },
        { delta: '-3', creadoEn: new Date('2026-08-05T12:00:00Z') },
      ],
      AHORA,
    )
    const agosto = meses.find((m) => m.clave === '2026-08')
    expect(agosto?.unidades).toBe(4)
  })

  it('un movimiento de un mes fuera de la ventana de 6 meses no se cuenta', () => {
    const meses = agregarVentasPorMes(
      [{ delta: '-10', creadoEn: new Date('2025-01-15T12:00:00Z') }],
      AHORA,
    )
    expect(meses.every((m) => m.unidades === 0)).toBe(true)
  })

  it('el cruce de año calcula bien el mes: enero cuenta como mes distinto de diciembre', () => {
    const ahoraEnero = new Date('2026-01-15T15:00:00Z')
    const meses = agregarVentasPorMes(
      [{ delta: '-5', creadoEn: new Date('2025-12-20T15:00:00Z') }],
      ahoraEnero,
    )
    expect(meses.map((m) => m.clave)).toEqual([
      '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01',
    ])
    const diciembre = meses.find((m) => m.clave === '2025-12')
    expect(diciembre?.unidades).toBe(5)
  })
})

/**
 * Extrae, en orden (marzo → agosto), la clase de color y el alto en px de
 * cada barra — para poder asertar CUÁL barra pinta con qué color y CUÁNTO
 * mide, en vez de sólo "el string bg-primary aparece en algún lado del html".
 */
function barrasDe(html: string): { clase: string; alto: number }[] {
  const re = /<div class="w-full rounded-t-\[6px\] (bg-primary|bg-accent)" style="height:(\d+)(?:px)?"><\/div>/g
  return [...html.matchAll(re)].map((m) => ({ clase: m[1], alto: Number(m[2]) }))
}

describe('GraficoDeRotacion', () => {
  it('sin ventas en ningún mes, no rompe: renderiza las 6 etiquetas igual', () => {
    const meses = agregarVentasPorMes([], AHORA)
    const html = renderToStaticMarkup(<GraficoDeRotacion meses={meses} />)
    expect(html).toContain('Mar')
    expect(html).toContain('Ago')
    expect(html).toContain('Cómo se movió')
  })

  // Distribución no uniforme entre meses (y con huecos en cero) para que una
  // mutación que fije `alto` en 0, o que use la escala equivocada, o que
  // confunda cuál mes es "el actual", tenga que fallar contra un número
  // puntual y no contra un simple "aparece bg-primary en algún lado".
  it('cada barra mide proporcional a su mes, con el actual (agosto, el último) en --primary', () => {
    const meses = agregarVentasPorMes(
      [
        { delta: '-10', creadoEn: new Date('2026-04-10T15:00:00Z') },
        { delta: '-5', creadoEn: new Date('2026-06-10T15:00:00Z') },
        { delta: '-20', creadoEn: new Date('2026-08-10T15:00:00Z') },
      ],
      AHORA,
    )
    const html = renderToStaticMarkup(<GraficoDeRotacion meses={meses} />)
    const barras = barrasDe(html)
    expect(barras).toHaveLength(6)
    // Mar, Abr, May, Jun, Jul, Ago — máximo = 20 (agosto), así que
    // Abr = round(10/20*88) = 44 y Jun = round(5/20*88) = 22.
    expect(barras.map((b) => b.alto)).toEqual([0, 44, 0, 22, 0, 88])
    expect(barras.map((b) => b.clase)).toEqual([
      'bg-accent', 'bg-accent', 'bg-accent', 'bg-accent', 'bg-accent', 'bg-primary',
    ])
    // Y el pie lee el mes ACTUAL (agosto, 20 unidades) y no meses[0] (marzo).
    expect(html).toContain('Unidades vendidas por mes. Agosto va en 20.')
  })

  it('con todos los meses en cero, las seis barras miden 0 (ninguna se ve, sin dividir por cero) y el pie lee el mes actual', () => {
    const meses = agregarVentasPorMes([], AHORA)
    const html = renderToStaticMarkup(<GraficoDeRotacion meses={meses} />)
    const barras = barrasDe(html)
    expect(barras).toHaveLength(6)
    expect(barras.every((b) => b.alto === 0)).toBe(true)
    // "de agosto" y no "de marzo" (meses[0]): el pie tiene que leer el mes
    // actual (el último del arreglo), no el primero.
    expect(html).toContain('Sin unidades vendidas de este artículo en lo que va de agosto.')
  })
})
