import { describe, it, expect } from 'vitest'
import {
  conElDolar, cotizacionDeHoy, cotizacionParaElCampo, cotizacionParaPrecargar, equivalenteEnPesos,
  esCotizacionVieja, esPrimeraInverosimil, esSaltoGrande, sugerenciaDeCotizacionVieja,
  type CotizacionDelLocal,
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

  // Sin reloj: la decide el `vieja` del servidor, el mismo que pinta el chip,
  // así que el texto no puede contradecir al chip (hallazgo de la review).
  it('la sugerencia nombra la fecha y el valor de la vieja, y calla con la de hoy o sin ninguna', () => {
    expect(sugerenciaDeCotizacionVieja(DEL_15, true)).toBe('La del local es del 15/10: $\u00a01.420')
    expect(sugerenciaDeCotizacionVieja(DE_HOY, false)).toBeNull()
    expect(sugerenciaDeCotizacionVieja(null, true)).toBeNull()
  })

  it('cargada la de hoy a mitad de la venta, la sugerencia se va con el mismo dato que el chip', () => {
    // Antes: vieja. Después de cargar: la vigente es de hoy y `vieja` pasa a false.
    expect(sugerenciaDeCotizacionVieja(DEL_15, true)).not.toBeNull()
    expect(sugerenciaDeCotizacionVieja(DE_HOY, false)).toBeNull()
  })
})

// El precargado pide que los DOS relojes digan "de hoy" (hallazgo de la
// review): el del servidor al armar la página y el del navegador al cruzar.
describe('cotizacionParaPrecargar: servidor Y navegador', () => {
  it('de hoy para los dos: precarga, escrita para el campo', () => {
    expect(cotizacionParaPrecargar(DE_HOY, false, AHORA)).toBe('1450')
    expect(cotizacionParaPrecargar({ ...DE_HOY, valor: '1450.5' }, false, AHORA)).toBe('1450,50')
  })

  // La PC del mostrador con la hora atrasada: para su reloj la carga del 15
  // sigue siendo de hoy, pero el servidor ya pintó el chip en ámbar.
  it('PC atrasada: el navegador dice "de hoy" pero el servidor dijo vieja → no precarga', () => {
    const relojAtrasado = new Date('2026-10-15T20:00:00Z')
    expect(cotizacionDeHoy(DEL_15, relojAtrasado)).toBe('1420')
    expect(cotizacionParaPrecargar(DEL_15, true, relojAtrasado)).toBeNull()
  })

  // La pantalla abierta de un día para el otro: el servidor dijo "de hoy" al
  // armarla ayer, pero el navegador ya está en el día siguiente.
  it('pasada la medianoche sin recargar: el servidor dijo de hoy pero el navegador no → no precarga', () => {
    expect(cotizacionParaPrecargar(DE_HOY, false, new Date('2026-10-19T12:00:00Z'))).toBeNull()
  })

  it('sin ninguna, nada', () => {
    expect(cotizacionParaPrecargar(null, false, AHORA)).toBeNull()
  })
})

describe('cotizacionParaElCampo escribe el valor como en el mostrador', () => {
  it('coma decimal con dos dígitos, y sin decimales si no los tiene', () => {
    expect(cotizacionParaElCampo('1450.5')).toBe('1450,50')
    expect(cotizacionParaElCampo('1450.25')).toBe('1450,25')
    expect(cotizacionParaElCampo('1450')).toBe('1450')
    expect(cotizacionParaElCampo('1450.00')).toBe('1450')
  })
})

describe('el equivalente en pesos de un precio en dólares', () => {
  it('con la de hoy: redondeado al peso y sin fecha', () => {
    expect(equivalenteEnPesos('1000', DE_HOY, AHORA)).toBe('≈ $ 1.450.000')
  })

  it('con una vieja: lleva la fecha', () => {
    expect(equivalenteEnPesos('1000', DEL_15, AHORA)).toBe('≈ $ 1.420.000 con el dólar del 15/10')
  })

  it('la forma corta de la lista lleva la fecha igual, en menos ancho', () => {
    expect(equivalenteEnPesos('1000', DEL_15, AHORA, 'corto')).toBe('≈ $\u00a01.420.000 · 15/10')
    expect(equivalenteEnPesos('1000', DE_HOY, AHORA, 'corto')).toBe('≈ $\u00a01.450.000')
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

describe('el tope de cordura de la PRIMERA carga', () => {
  it('sin vigente, fuera de $ 100–$ 100.000 pide confirmar', () => {
    expect(esPrimeraInverosimil('99.99', null)).toBe(true)
    expect(esPrimeraInverosimil('100', null)).toBe(false)
    expect(esPrimeraInverosimil('1450', null)).toBe(false)
    expect(esPrimeraInverosimil('100000', null)).toBe(false)
    expect(esPrimeraInverosimil('100000.01', null)).toBe(true)
    expect(esPrimeraInverosimil('14.5', null)).toBe(true)
  })

  it('con vigente no se usa: manda la comparación contra ella', () => {
    expect(esPrimeraInverosimil('14.5', '1450')).toBe(false)
  })
})
