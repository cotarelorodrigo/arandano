import { describe, it, expect } from 'vitest'
import { rotuloDeMedios, formateadorDe } from './medios'
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'

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

// Antes duplicada, sin nombre, en app/(app)/ventas/grafico.tsx
// (`moneda === 'ars' ? formatearPrecio : formatearDolares`) y con nombre en
// app/(app)/dashboard/paneles.tsx — unificada acá (review final de rama).
describe('formateadorDe', () => {
  // El esperado sale de llamar al formateador real, no se tipea a mano:
  // `Intl.NumberFormat('es-AR', { style: 'currency' })` separa el símbolo
  // con un espacio DURO (U+00A0), así que un literal con espacio común
  // fallaría por un carácter invisible (mismo hallazgo que Ruling C del
  // ciclo del dashboard).
  it('en pesos, usa el formateador de pesos', () => {
    expect(formateadorDe('ars')('512400')).toBe(formatearPrecio('512400'))
  })

  it('en dólares, usa el formateador de dólares', () => {
    expect(formateadorDe('usd')('300')).toBe(formatearDolares('300'))
  })

  // Lo que distingue a un formateador del otro: no es sólo que llame a la
  // función correcta, es que la salida sea distinguible entre sí.
  it('las dos monedas no formatean igual', () => {
    expect(formateadorDe('ars')('300')).not.toBe(formateadorDe('usd')('300'))
  })
})
