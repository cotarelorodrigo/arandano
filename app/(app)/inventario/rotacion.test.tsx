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

describe('GraficoDeRotacion', () => {
  it('sin ventas en ningún mes, no rompe: renderiza las 6 etiquetas igual', () => {
    const meses = agregarVentasPorMes([], AHORA)
    const html = renderToStaticMarkup(<GraficoDeRotacion meses={meses} />)
    expect(html).toContain('Mar')
    expect(html).toContain('Ago')
    expect(html).toContain('Cómo se movió')
  })

  it('el mes actual (el último del arreglo) pinta con --primary', () => {
    const meses = agregarVentasPorMes(
      [{ delta: '-2', creadoEn: new Date('2026-08-10T15:00:00Z') }],
      AHORA,
    )
    const html = renderToStaticMarkup(<GraficoDeRotacion meses={meses} />)
    expect(html).toContain('bg-primary')
  })

  it('con todos los meses en cero, ninguna barra usa --primary ni --accent como fondo con alto', () => {
    // No debe reventar por dividir por cero (máximo === 0).
    const meses = agregarVentasPorMes([], AHORA)
    expect(() => renderToStaticMarkup(<GraficoDeRotacion meses={meses} />)).not.toThrow()
  })
})
