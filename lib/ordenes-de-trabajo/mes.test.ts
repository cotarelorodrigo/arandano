import { describe, it, expect } from 'vitest'
import {
  mesEnCurso,
  mesValido,
  rangoDelMes,
  mesAnterior,
  mesSiguiente,
  nombreDelMes,
} from './mes'

const AHORA = new Date('2026-11-15T15:00:00Z')

describe('mesEnCurso', () => {
  it('usa la hora argentina, no la UTC', () => {
    expect(mesEnCurso(new Date('2026-11-01T02:30:00Z'))).toBe('2026-10')
    expect(mesEnCurso(AHORA)).toBe('2026-11')
  })
})

describe('rangoDelMes', () => {
  it('va de las 00:00 -03:00 del día 1 al día 1 siguiente (exclusivo)', () => {
    const r = rangoDelMes('2026-10')
    expect(r.desde.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(r.hasta.toISOString()).toBe('2026-11-01T03:00:00.000Z')
  })
  it('diciembre cierra en enero del año siguiente', () => {
    expect(rangoDelMes('2026-12').hasta.toISOString()).toBe('2027-01-01T03:00:00.000Z')
  })
})

describe('mesValido', () => {
  it('cae al mes en curso con basura o futuro', () => {
    for (const v of ['2026-13', 'abc', undefined, '9999-01', '2026-00', '2026-12'])
      expect(mesValido(v, AHORA)).toBe('2026-11')
  })
  it('acepta pasado y el mes en curso', () => {
    expect(mesValido('2026-09', AHORA)).toBe('2026-09')
    expect(mesValido('2026-11', AHORA)).toBe('2026-11')
  })
})

describe('mesAnterior / mesSiguiente', () => {
  it('cruzan el año', () => {
    expect(mesAnterior('2026-01')).toBe('2025-12')
    expect(mesSiguiente('2026-12')).toBe('2027-01')
    expect(mesAnterior('2026-11')).toBe('2026-10')
    expect(mesSiguiente('2026-09')).toBe('2026-10')
  })
})

describe('nombreDelMes', () => {
  it('mes en minúscula y año, sin "de"', () => {
    expect(nombreDelMes('2026-11')).toBe('noviembre 2026')
    expect(nombreDelMes('2026-01')).toBe('enero 2026')
  })
})
