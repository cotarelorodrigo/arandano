import { describe, it, expect } from 'vitest'
import {
  conElDolar, cotizacionDeHoy, equivalenteEnPesos, esCotizacionVieja, esSaltoGrande,
  sugerenciaDeCotizacionVieja, type CotizacionDelLocal,
} from './reglas'

// 18/10 a las 15:00 de Buenos Aires.
const AHORA = new Date('2026-10-18T18:00:00Z')
const DE_HOY: CotizacionDelLocal = { valor: '1450', creadaEn: new Date('2026-10-18T12:30:00Z') }
const DEL_15: CotizacionDelLocal = { valor: '1420', creadaEn: new Date('2026-10-15T14:00:00Z') }

describe('la cotización del local se usa sola sólo si es de hoy', () => {
  it('cotizacionDeHoy devuelve la de hoy, y null para la vieja o para ninguna', () => {
    expect(cotizacionDeHoy(DE_HOY, AHORA)).toBe('1450')
    expect(cotizacionDeHoy(DEL_15, AHORA)).toBeNull()
    expect(cotizacionDeHoy(null, AHORA)).toBeNull()
  })

  // El borde que importa: la de las 23:59 deja de valer a las 00:00 ARGENTINAS,
  // que en UTC son las 03:00 del mismo día.
  it('la de ayer a las 23:59 ya no se precarga a las 00:00', () => {
    const ultimoMinuto: CotizacionDelLocal = { valor: '1450', creadaEn: new Date('2026-10-18T02:59:00Z') }
    expect(cotizacionDeHoy(ultimoMinuto, new Date('2026-10-18T03:00:00Z'))).toBeNull()
    expect(cotizacionDeHoy(ultimoMinuto, new Date('2026-10-18T02:59:59Z'))).toBe('1450')
  })

  it('esCotizacionVieja: sin ninguna o de otro día', () => {
    expect(esCotizacionVieja(DE_HOY, AHORA)).toBe(false)
    expect(esCotizacionVieja(DEL_15, AHORA)).toBe(true)
    expect(esCotizacionVieja(null, AHORA)).toBe(true)
  })

  it('la sugerencia nombra la fecha y el valor de la vieja, y calla con la de hoy o sin ninguna', () => {
    expect(sugerenciaDeCotizacionVieja(DEL_15, AHORA)).toBe('La del local es del 15/10: $ 1.420')
    expect(sugerenciaDeCotizacionVieja(DE_HOY, AHORA)).toBeNull()
    expect(sugerenciaDeCotizacionVieja(null, AHORA)).toBeNull()
  })
})

describe('el equivalente en pesos de un precio en dólares', () => {
  it('con la de hoy: redondeado al peso y sin fecha', () => {
    expect(equivalenteEnPesos('1000', DE_HOY, AHORA)).toBe('≈ $ 1.450.000')
  })

  it('con una vieja: lleva la fecha', () => {
    expect(equivalenteEnPesos('1000', DEL_15, AHORA)).toBe('≈ $ 1.420.000 con el dólar del 15/10')
  })

  it('sin ninguna: null, no un número inventado', () => {
    expect(equivalenteEnPesos('1000', null, AHORA)).toBeNull()
  })

  it('el producto se redondea al centavo y después al peso', () => {
    // US$ 0,99 × 1450,50 = 1435,995 → 1436,00 al centavo → $ 1.436.
    expect(equivalenteEnPesos('0.99', { ...DE_HOY, valor: '1450.50' }, AHORA)).toBe('≈ $ 1.436')
  })
})

describe('el pie del margen con el dólar', () => {
  it('lleva siempre valor y fecha, sea de hoy o no', () => {
    expect(conElDolar(DE_HOY)).toBe('con el dólar a $ 1.450 del 18/10')
    expect(conElDolar({ ...DEL_15, valor: '1420.50' })).toBe('con el dólar a $ 1.420,50 del 15/10')
  })
})

describe('el tope de cordura al cargar', () => {
  it('sin vigente no pide confirmar', () => {
    expect(esSaltoGrande('14500', null)).toBe(false)
  })

  it('un cero de más o de menos pide confirmar', () => {
    expect(esSaltoGrande('14500', '1450')).toBe(true)
    expect(esSaltoGrande('145', '1450')).toBe(true)
  })

  it('exactamente la mitad no pide; un centavo más, sí', () => {
    expect(esSaltoGrande('2175', '1450')).toBe(false)
    expect(esSaltoGrande('2175.01', '1450')).toBe(true)
    expect(esSaltoGrande('725', '1450')).toBe(false)
    expect(esSaltoGrande('724.99', '1450')).toBe(true)
  })

  it('el movimiento de todos los días no pide nada', () => {
    expect(esSaltoGrande('1475', '1450')).toBe(false)
  })
})
