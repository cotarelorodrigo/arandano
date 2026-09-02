import { describe, it, expect } from 'vitest'
import {
  inicioDelDia, sumarDias, primerDiaDelMes, primerDiaDelAnio, fechaLarga, fechaOhoy,
} from './fechas'

describe('las primitivas de fecha anclan a Buenos Aires', () => {
  it('inicioDelDia ancla a UTC-3, no a UTC', () => {
    expect(inicioDelDia('2026-08-21').toISOString()).toBe('2026-08-21T03:00:00.000Z')
  })

  it('sumarDias cruza el fin de mes', () => {
    expect(sumarDias('2026-08-31', 1)).toBe('2026-09-01')
    expect(sumarDias('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('primerDiaDelMes y primerDiaDelAnio recortan', () => {
    expect(primerDiaDelMes('2026-08-21')).toBe('2026-08-01')
    expect(primerDiaDelAnio('2026-08-21')).toBe('2026-01-01')
  })

  it('fechaLarga no se corre un día por el huso', () => {
    expect(fechaLarga('2026-08-01')).toBe('1 de agosto de 2026')
  })

  it('fechaOhoy cae al default con una fecha imposible', () => {
    // 2026-13-45 pasa cualquier regex de \d{4}-\d{2}-\d{2} y después da un
    // Invalid Date que Prisma rechaza sin que nadie lo atrape.
    expect(fechaOhoy('2026-13-45', '2026-08-21')).toBe('2026-08-21')
    expect(fechaOhoy(undefined, '2026-08-21')).toBe('2026-08-21')
    expect(fechaOhoy('2026-08-01', '2026-08-21')).toBe('2026-08-01')
  })
})
