import { describe, it, expect, vi, afterEach } from 'vitest'
import { fechaCorta, diasEnElLocal } from './antiguedad'

// Puro: sin Docker, sin base. `Intl` alcanza y corre en cualquier Node.

describe('fechaCorta', () => {
  it('formatea como DD/MM/AAAA, con ceros de relleno', () => {
    expect(fechaCorta(new Date('2026-07-29T15:00:00-03:00'))).toBe('29/07/2026')
  })

  // El caso load-bearing, igual que el de `formatearFecha` en
  // lib/formato/mostrar.test.ts: sin el huso de Buenos Aires declarado, este
  // mismo instante se lee con el huso del servidor (Ashburn, UTC-4/-5) y cae
  // en el día equivocado.
  it('usa el día de Buenos Aires, no el de UTC', () => {
    // 2026-03-15T01:30:00Z son las 22:30 del 14 de marzo en Buenos Aires.
    expect(fechaCorta(new Date('2026-03-15T01:30:00Z'))).toBe('14/03/2026')
  })
})

describe('diasEnElLocal', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('el ejemplo de la maqueta: del 29/07 al 21/08 son 23 días', () => {
    const creadoEn = new Date('2026-07-29T10:00:00-03:00')
    const ahora = new Date('2026-08-21T10:00:00-03:00')
    expect(diasEnElLocal(creadoEn, ahora)).toBe(23)
  })

  it('ayer contra hoy es 1 día, no 0', () => {
    const creadoEn = new Date('2026-08-20T09:00:00-03:00')
    const ahora = new Date('2026-08-21T18:00:00-03:00')
    expect(diasEnElLocal(creadoEn, ahora)).toBe(1)
  })

  it('el mismo día calendario es 0, aunque hayan pasado varias horas', () => {
    const creadoEn = new Date('2026-08-21T08:00:00-03:00')
    const ahora = new Date('2026-08-21T20:00:00-03:00')
    expect(diasEnElLocal(creadoEn, ahora)).toBe(0)
  })

  // El caso que justifica todo el mecanismo del offset explícito: un equipo
  // que entra a último momento del día en Buenos Aires y se consulta poco
  // después, ya cruzada la medianoche ARGENTINA. En reloj real pasaron 20
  // minutos; en huso Buenos Aires ya es "un día" (23:50 del 20 → 00:10 del
  // 21). Un cálculo que convirtiera a día-calendario en UTC, o que hiciera la
  // resta directamente en milisegundos, vería las dos fechas caer en el
  // MISMO día UTC (21/08, porque el offset -03:00 corre el corte 3 horas) y
  // devolvería 0 acá donde el mostrador ya tiene que decir "entró ayer".
  it('cruza la medianoche de Buenos Aires aunque casi no pasó tiempo de reloj', () => {
    const creadoEn = new Date('2026-08-20T23:50:00-03:00')
    const ahora = new Date('2026-08-21T00:10:00-03:00')
    expect(diasEnElLocal(creadoEn, ahora)).toBe(1)
  })

  it('sin `ahora`, usa la hora real del sistema', () => {
    // vi.setSystemTime en vez de comparar contra `new Date()` en el propio
    // test: así el caso queda determinístico y no depende de en qué
    // milisegundo exacto corre la suite.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T15:00:00-03:00'))
    const creadoEn = new Date('2026-08-19T09:00:00-03:00')
    expect(diasEnElLocal(creadoEn)).toBe(2)
  })
})
