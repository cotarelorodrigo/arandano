import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VentasPorDia, TopDeArticulos } from './paneles'

// El selector `$ / US$` ya NO vive acá: es SelectorDeMonedaElegida
// (components/selector-de-moneda-elegida.tsx), compartido con /ventas, con
// su propio test en components/selector-de-moneda-elegida.test.tsx (review
// final de rama — este archivo tenía una copia byte a byte del marcado que
// también vivía, ya divergida, en app/(app)/ventas/grafico.tsx).

describe('ventas por día', () => {
  const barras = [
    { dia: '2026-08-19', etiqueta: '19', monto: '512400', ventas: 23, esMejor: true },
    { dia: '2026-08-20', etiqueta: '20', monto: '256200', ventas: 11, esMejor: false },
  ]

  it('la barra más alta es la del mejor día', () => {
    const html = renderToStaticMarkup(
      <VentasPorDia barras={barras} pie="El miércoles 19 fue el mejor…" moneda="ars" />,
    )
    expect(html).toContain('height:100%')
    expect(html).toContain('height:50%')
  })

  it('dice cuántos días muestra, para que nadie lo lea como el período', () => {
    const html = renderToStaticMarkup(<VentasPorDia barras={barras} pie={null} moneda="ars" />)
    expect(html).toContain('últimos 14 días')
  })

  // Sin ventas, dividir por el máximo sería dividir por cero.
  it('con todo en cero no explota ni dibuja barras llenas', () => {
    const vacias = barras.map((b) => ({ ...b, monto: '0', ventas: 0, esMejor: false }))
    const html = renderToStaticMarkup(<VentasPorDia barras={vacias} pie={null} moneda="ars" />)
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('height:100%')
  })
})

describe('lo que más se vendió', () => {
  it('la barra de cada fila es proporcional al primero', () => {
    const html = renderToStaticMarkup(
      <TopDeArticulos filas={[
        { nombre: 'iPhone 13 128 GB', unidades: '12', importe: '2964000', ancho: 100 },
        { nombre: 'Cambio de módulo', unidades: '31', importe: '1612000', ancho: 54 },
      ]} moneda="ars" />,
    )
    expect(html).toContain('width:100%')
    expect(html).toContain('width:54%')
    expect(html).toContain('12 u.')
  })

  it('sin ventas muestra un vacío, no una tabla vacía', () => {
    expect(renderToStaticMarkup(<TopDeArticulos filas={[]} moneda="ars" />))
      .toContain('Todavía no se vendió nada')
  })

  // Pieza 4 del spec: faltaba en código, en el plan y en
  // docs/correcciones-pendientes-del-pen.md por igual (review final de rama).
  it('lleva el link "Ver inventario →" a /inventario', () => {
    const html = renderToStaticMarkup(<TopDeArticulos filas={[]} moneda="ars" />)
    expect(html).toContain('href="/inventario"')
    expect(html).toContain('Ver inventario')
  })
})
