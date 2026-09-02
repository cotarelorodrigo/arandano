import { describe, it, expect } from 'vitest'
import { rotuloDeMedios } from './medios'

describe('rotuloDeMedios', () => {
  it('un solo medio en pesos', () => {
    expect(rotuloDeMedios([{ medio: 'EFECTIVO', moneda: 'ARS' }])).toBe('Efectivo')
  })

  it('un medio con algún pago en dólares lo marca', () => {
    // La fila #1040 del relevamiento: "Efectivo · US$" — dos pagos en
    // efectivo, uno en pesos y otro en dólares, es UN medio con la marca.
    expect(
      rotuloDeMedios([
        { medio: 'EFECTIVO', moneda: 'ARS' },
        { medio: 'EFECTIVO', moneda: 'USD' },
      ]),
    ).toBe('Efectivo · US$')
  })

  it('dos medios distintos se listan los dos, en el orden de los pagos', () => {
    expect(
      rotuloDeMedios([
        { medio: 'TRANSFERENCIA', moneda: 'ARS' },
        { medio: 'EFECTIVO', moneda: 'ARS' },
      ]),
    ).toBe('Transferencia + Efectivo')
  })

  it('sin pagos, una raya y no una cadena vacía', () => {
    expect(rotuloDeMedios([])).toBe('—')
  })

  it('rotula en castellano, nunca el nombre del enum', () => {
    expect(rotuloDeMedios([{ medio: 'TARJETA_CREDITO', moneda: 'ARS' }])).not.toContain('TARJETA')
  })
})
