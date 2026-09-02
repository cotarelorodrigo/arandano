import { describe, it, expect } from 'vitest'
import { agregarPorDia, pieDeTendencia, DIAS_DE_TENDENCIA } from './tendencia'
import { formatearPrecio } from '@/lib/formato/mostrar'

const v = (iso: string, total: string, totalUsd = '0') => ({
  creadoEn: new Date(`${iso}T15:00:00-03:00`), total, totalUsd,
})

describe('la ventana es fija: catorce días, no el rango elegido', () => {
  it('devuelve siempre 14 barras, aunque no haya ninguna venta', () => {
    const b = agregarPorDia([], '2026-08-21', 'ars')
    expect(b).toHaveLength(DIAS_DE_TENDENCIA)
    expect(b[0].dia).toBe('2026-08-08')
    expect(b[13].dia).toBe('2026-08-21')
    expect(b.every((x) => x.monto === '0' && x.ventas === 0)).toBe(true)
  })

  it('un día sin ventas en el medio queda en cero, no se saltea', () => {
    const b = agregarPorDia([v('2026-08-08', '100'), v('2026-08-10', '300')], '2026-08-21', 'ars')
    expect(b[1].monto).toBe('0')
    expect(b[2].monto).toBe('300')
  })

  // El huso importa: una venta de las 23:00 del 19 en Buenos Aires ya es el 20
  // en UTC, y sin anclar caería en la barra equivocada.
  it('agrupa por el día de Buenos Aires, no por el de UTC', () => {
    const tarde = { creadoEn: new Date('2026-08-19T23:30:00-03:00'), total: '500', totalUsd: '0' }
    const b = agregarPorDia([tarde], '2026-08-21', 'ars')
    expect(b.find((x) => x.dia === '2026-08-19')?.monto).toBe('500')
  })

  it('una venta fuera de la ventana no entra', () => {
    const b = agregarPorDia([v('2026-08-01', '999')], '2026-08-21', 'ars')
    expect(b.every((x) => x.monto === '0')).toBe(true)
  })
})

describe('la moneda elegida decide qué columna se suma', () => {
  it('en pesos suma total y en dólares suma totalUsd', () => {
    const mixta = [v('2026-08-19', '1000', '300')]
    expect(agregarPorDia(mixta, '2026-08-21', 'ars')[11].monto).toBe('1000')
    expect(agregarPorDia(mixta, '2026-08-21', 'usd')[11].monto).toBe('300')
  })
})

describe('el mejor día', () => {
  it('marca uno solo, el de más plata', () => {
    const b = agregarPorDia(
      [v('2026-08-19', '512400'), v('2026-08-17', '300000')], '2026-08-21', 'ars',
    )
    expect(b.filter((x) => x.esMejor).map((x) => x.dia)).toEqual(['2026-08-19'])
  })

  // Sin esto, catorce barras en cero marcarían la primera como "mejor día" y
  // el pie afirmaría un récord de $ 0.
  it('con todo en cero no hay mejor día ni pie', () => {
    const b = agregarPorDia([], '2026-08-21', 'ars')
    expect(b.some((x) => x.esMejor)).toBe(false)
    expect(pieDeTendencia(b, 'ars')).toBeNull()
  })

  it('el empate lo gana el más reciente', () => {
    const b = agregarPorDia([v('2026-08-17', '100'), v('2026-08-19', '100')], '2026-08-21', 'ars')
    expect(b.filter((x) => x.esMejor).map((x) => x.dia)).toEqual(['2026-08-19'])
  })

  // No dice "del mes": la ventana son catorce días y afirmar el mes sería falso.
  // La plata esperada se arma llamando a formatearPrecio en vez de tipearla a
  // mano: el separador entre el símbolo y el número es un espacio irrompible
  // (U+00A0), no el espacio común, y un literal tipeado a mano lo falla sin
  // que la implementación tenga nada de malo.
  it('el pie nombra el día, su plata y su cantidad de ventas', () => {
    const b = agregarPorDia(
      [v('2026-08-19', '300000'), v('2026-08-19', '212400')], '2026-08-21', 'ars',
    )
    expect(pieDeTendencia(b, 'ars'))
      .toBe(`El miércoles 19 fue el mejor de los últimos 14 días: ${formatearPrecio('512400')} en 2 ventas.`)
  })
})
