import { describe, it, expect } from 'vitest'
import {
  rangoValido, periodoDeRango, periodoAnterior, rotuloDeComparacion,
  textoDelPeriodo, filtroDe,
} from './rango'

// Un viernes 21 de agosto de 2026, a mitad de mes: el caso que distingue el
// tramo homólogo de la ventana previa.
const HOY = '2026-08-21'

describe('el período de cada chip', () => {
  it('hoy es un solo día', () => {
    expect(periodoDeRango('hoy', HOY)).toEqual({ desde: HOY, hasta: HOY })
  })

  it('7 días incluye hoy, así que resta 6', () => {
    expect(periodoDeRango('7dias', HOY)).toEqual({ desde: '2026-08-15', hasta: HOY })
  })

  it('este mes va del 1 a hoy, no al fin de mes', () => {
    expect(periodoDeRango('estemes', HOY)).toEqual({ desde: '2026-08-01', hasta: HOY })
  })

  it('este año va del 1 de enero a hoy', () => {
    expect(periodoDeRango('esteanio', HOY)).toEqual({ desde: '2026-01-01', hasta: HOY })
  })
})

describe('el período anterior es el tramo homólogo, no la ventana previa', () => {
  it('hoy compara contra ayer', () => {
    expect(periodoAnterior('hoy', HOY)).toEqual({ desde: '2026-08-20', hasta: '2026-08-20' })
  })

  it('7 días compara contra los 7 anteriores, sin solaparse', () => {
    expect(periodoAnterior('7dias', HOY)).toEqual({ desde: '2026-08-08', hasta: '2026-08-14' })
  })

  // El caso que define la decisión: la ventana previa del mismo largo daría
  // del 20 al 31 de julio, y el rótulo "Comparado con julio" sería mentira.
  it('este mes compara contra el MISMO TRAMO del mes pasado', () => {
    expect(periodoAnterior('estemes', HOY)).toEqual({ desde: '2026-07-01', hasta: '2026-07-21' })
  })

  it('este año compara contra el mismo tramo del año pasado', () => {
    expect(periodoAnterior('esteanio', HOY)).toEqual({ desde: '2025-01-01', hasta: '2025-08-21' })
  })

  // Un 31 de marzo no tiene homólogo en febrero. Se recorta al último día que
  // existe en vez de desbordar al 3 de marzo, que es lo que hace Date solo.
  it('recorta cuando el día no existe en el mes anterior', () => {
    expect(periodoAnterior('estemes', '2026-03-31')).toEqual({
      desde: '2026-02-01', hasta: '2026-02-28',
    })
  })

  // El 29 de febrero de un bisiesto no existe el año anterior.
  it('recorta también en el salto de año', () => {
    expect(periodoAnterior('esteanio', '2024-02-29')).toEqual({
      desde: '2023-01-01', hasta: '2023-02-28',
    })
  })

  it('el día 1 del mes compara contra un solo día', () => {
    expect(periodoAnterior('estemes', '2026-08-01')).toEqual({
      desde: '2026-07-01', hasta: '2026-07-01',
    })
  })
})

describe('los rótulos', () => {
  it('el chip de comparación nombra el período, no las fechas', () => {
    expect(rotuloDeComparacion('hoy', HOY)).toBe('Comparado con ayer')
    expect(rotuloDeComparacion('7dias', HOY)).toBe('Comparado con los 7 días previos')
    expect(rotuloDeComparacion('estemes', HOY)).toBe('Comparado con julio')
    expect(rotuloDeComparacion('esteanio', HOY)).toBe('Comparado con 2025')
  })

  it('el texto del período une las dos puntas sin repetir el mes', () => {
    expect(textoDelPeriodo({ desde: '2026-08-01', hasta: '2026-08-21' }))
      .toBe('1 al 21 de agosto de 2026')
    expect(textoDelPeriodo({ desde: '2026-08-21', hasta: '2026-08-21' }))
      .toBe('21 de agosto de 2026')
    expect(textoDelPeriodo({ desde: '2026-07-28', hasta: '2026-08-03' }))
      .toBe('28 de julio al 3 de agosto de 2026')
  })
})

describe('el filtro que va a Prisma', () => {
  // `lt` sobre el día SIGUIENTE, nunca `lte` sobre `hasta`: `hasta` es
  // medianoche, así que un `lte` dejaría afuera todas las ventas del último día.
  it('cierra por abajo y abre por arriba, con el día siguiente', () => {
    const f = filtroDe({ desde: '2026-08-01', hasta: '2026-08-21' })
    expect(f.creadoEn.gte.toISOString()).toBe('2026-08-01T03:00:00.000Z')
    expect(f.creadoEn.lt.toISOString()).toBe('2026-08-22T03:00:00.000Z')
  })
})

describe('el chip inválido cae al default', () => {
  it('lo que no está en la lista es este mes', () => {
    expect(rangoValido(undefined)).toBe('estemes')
    expect(rangoValido('la semana que viene')).toBe('estemes')
    expect(rangoValido('7dias')).toBe('7dias')
  })
})
