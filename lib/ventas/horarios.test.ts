import { describe, it, expect } from 'vitest'
import { agregarPorTiempo, vistaValida } from './horarios'

/** Un instante UTC, que es como Postgres devuelve `Venta.creadoEn`. */
const utc = (iso: string) => new Date(iso)

describe('vistaValida', () => {
  it('cae en hora ante cualquier cosa que no sea dia', () => {
    // Mismo criterio que fechaOhoy y que el clamp de ?p: un query string
    // escrito a mano no puede servir un 500.
    expect(vistaValida('dia')).toBe('dia')
    expect(vistaValida('hora')).toBe('hora')
    expect(vistaValida(undefined)).toBe('hora')
    expect(vistaValida('AAAA')).toBe('hora')
  })
})

describe('agregarPorTiempo · vista hora', () => {
  it('cuenta en hora de Buenos Aires y no en UTC', () => {
    // 23:30 UTC son las 20:30 en Buenos Aires. Sin el huso declarado, esta
    // venta caería en la barra de las 23 y el local vería un pico que no
    // existe tres horas después de cerrar.
    const { barras } = agregarPorTiempo([utc('2026-08-21T23:30:00Z')], 'hora')
    const conVentas = barras.filter((b) => b.ventas > 0)
    expect(conVentas).toHaveLength(1)
    expect(conVentas[0].clave).toBe('20')
  })

  it('la franja va de la hora más temprana a la más tardía con ventas', () => {
    // Un local que abre a las 8 y cierra a las 22: quince barras, no las doce
    // que dibuja la maqueta. Con la franja fija, esas dos ventas de los
    // extremos no aparecerían en ningún lado.
    const { barras } = agregarPorTiempo(
      [utc('2026-08-21T11:00:00Z'), utc('2026-08-22T01:00:00Z')],
      'hora',
    )
    expect(barras.map((b) => b.clave)).toEqual([
      '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22',
    ])
  })

  it('sin ninguna venta, la franja es la de la maqueta', () => {
    const { barras, pie } = agregarPorTiempo([], 'hora')
    expect(barras.map((b) => b.clave)).toEqual([
      '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
    ])
    expect(barras.every((b) => b.ventas === 0 && !b.pico)).toBe(true)
    expect(pie).toBe('Todavía no hubo ventas en este período.')
  })

  it('marca una sola barra como pico y lo dice en el pie', () => {
    const fechas = [
      utc('2026-08-21T21:00:00Z'), // 18 h
      utc('2026-08-21T21:30:00Z'), // 18 h
      utc('2026-08-21T15:00:00Z'), // 12 h
    ]
    const { barras, pie } = agregarPorTiempo(fechas, 'hora')
    expect(barras.filter((b) => b.pico).map((b) => b.clave)).toEqual(['18'])
    expect(pie).toBe('El pico es a las 18 h, con 2 ventas.')
  })

  it('con empate gana la hora más temprana', () => {
    // Dos horas con una venta cada una: pintar las dos de --primary diría que
    // hubo dos picos, y el pie tendría que elegir igual. Elige una sola, y es
    // la primera — el mismo criterio para el color y para el texto.
    const { barras, pie } = agregarPorTiempo(
      [utc('2026-08-21T13:00:00Z'), utc('2026-08-21T21:00:00Z')],
      'hora',
    )
    expect(barras.filter((b) => b.pico).map((b) => b.clave)).toEqual(['10'])
    expect(pie).toBe('El pico es a las 10 h, con 1 venta.')
  })
})

describe('agregarPorTiempo · vista día', () => {
  it('son siempre siete barras, de lunes a domingo', () => {
    const { barras } = agregarPorTiempo([utc('2026-08-21T15:00:00Z')], 'dia')
    expect(barras.map((b) => b.rotulo)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'])
  })

  it('agrupa por día de la semana en hora de Buenos Aires', () => {
    // 2026-08-21 es viernes. A las 02:00 UTC del sábado 22 todavía es viernes
    // en Buenos Aires (23:00), así que las dos ventas caen en el mismo día.
    const { barras, pie } = agregarPorTiempo(
      [utc('2026-08-21T15:00:00Z'), utc('2026-08-22T02:00:00Z')],
      'dia',
    )
    const viernes = barras.find((b) => b.rotulo === 'Vie')
    expect(viernes?.ventas).toBe(2)
    expect(viernes?.pico).toBe(true)
    expect(pie).toBe('El pico es el viernes, con 2 ventas.')
  })
})
