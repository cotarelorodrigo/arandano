import { describe, it, expect } from 'vitest'
import {
  inicioDelDia, sumarDias, primerDiaDelMes, primerDiaDelAnio, fechaLarga, fechaOhoy,
  diaEnArgentina, esDeHoy,
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

// La regla que decide si la cotización del dólar del local se usa sola
// (spec 2026-10-18-cotizacion-del-dolar). Los bordes son los de la medianoche
// ARGENTINA, que en UTC son las 03:00: es exactamente donde comparar en el huso
// del servidor (o en UTC) se equivoca.
describe('esDeHoy mide el día en hora argentina', () => {
  // 23:59 del 17/10 en Buenos Aires = 02:59 UTC del 18/10.
  const ultimoMinutoDel17 = new Date('2026-10-18T02:59:00Z')
  // 00:00 del 18/10 en Buenos Aires = 03:00 UTC del 18/10.
  const medianocheDel18 = new Date('2026-10-18T03:00:00Z')

  it('diaEnArgentina corre el día en el borde, no a las 00:00 UTC', () => {
    expect(diaEnArgentina(ultimoMinutoDel17)).toBe('2026-10-17')
    expect(diaEnArgentina(medianocheDel18)).toBe('2026-10-18')
  })

  it('una cargada a las 23:59 ya no es de hoy a las 00:00, aunque en UTC sea el mismo día', () => {
    expect(esDeHoy(ultimoMinutoDel17, medianocheDel18)).toBe(false)
  })

  it('una cargada a las 00:00 sigue siendo de hoy a las 23:59 del mismo día argentino', () => {
    // 23:59 del 18/10 en Buenos Aires = 02:59 UTC del 19/10: OTRO día en UTC.
    expect(esDeHoy(medianocheDel18, new Date('2026-10-19T02:59:00Z'))).toBe(true)
  })

  it('a la noche argentina, cuando en Ashburn y en UTC ya es mañana, la de la tarde sigue siendo de hoy', () => {
    const tarde = new Date('2026-10-18T18:00:00Z') // 15:00 ART
    const noche = new Date('2026-10-19T01:30:00Z') // 22:30 ART, 19/10 en UTC
    expect(esDeHoy(tarde, noche)).toBe(true)
  })

  it('la de ayer no es de hoy aunque falten menos de 24 horas', () => {
    const ayerALas22 = new Date('2026-10-18T01:00:00Z') // 22:00 ART del 17/10
    const hoyALas9 = new Date('2026-10-18T12:00:00Z') // 09:00 ART del 18/10
    expect(esDeHoy(ayerALas22, hoyALas9)).toBe(false)
  })
})
