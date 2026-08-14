import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { componerPorMedio, MEDIOS } from './composicion'

const d = (v: string) => new Prisma.Decimal(v)

/** Una fila del `groupBy`, con lo justo. */
const fila = (
  medio: (typeof MEDIOS)[number],
  moneda: 'ARS' | 'USD',
  monto: string,
  cotizacion = '1',
) => ({ medio, moneda, cotizacion: d(cotizacion), _sum: { monto: d(monto) } })

describe('componerPorMedio', () => {
  it('sin pagos devuelve nada', () => {
    expect(componerPorMedio([])).toEqual({ barras: [], total: '0', hayDolares: false })
  })

  it('convierte los dólares a pesos con la cotización de cada grupo', () => {
    // El mismo medio, dos cotizaciones distintas: es exactamente por eso que el
    // groupBy agrupa TAMBIÉN por cotizacion, y lo que este caso protege.
    const { barras } = componerPorMedio([
      fila('EFECTIVO', 'USD', '100', '1200'),
      fila('EFECTIVO', 'USD', '50', '1300'),
    ])
    expect(barras).toEqual([{ medio: 'EFECTIVO', ars: '0', usd: '185000', total: '185000' }])
  })

  it('separa pesos de dólares dentro del mismo medio', () => {
    const { barras, hayDolares } = componerPorMedio([
      fila('EFECTIVO', 'ARS', '5000'),
      fila('EFECTIVO', 'USD', '10', '1200'),
    ])
    expect(barras).toEqual([{ medio: 'EFECTIVO', ars: '5000', usd: '12000', total: '17000' }])
    expect(hayDolares).toBe(true)
  })

  it('ordena de mayor a menor por el total de la barra', () => {
    const { barras } = componerPorMedio([
      fila('TARJETA_DEBITO', 'ARS', '100'),
      fila('EFECTIVO', 'ARS', '900'),
      fila('TRANSFERENCIA', 'ARS', '500'),
    ])
    expect(barras.map((b) => b.medio)).toEqual(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO'])
  })

  it('omite los medios sin pagos en vez de dibujarlos en cero', () => {
    // Una barra de largo cero no dice "no se cobró así": dice "acá falta algo".
    const { barras } = componerPorMedio([fila('EFECTIVO', 'ARS', '900')])
    expect(barras).toHaveLength(1)
  })

  it('el total es la suma de las barras', () => {
    const { total } = componerPorMedio([
      fila('EFECTIVO', 'ARS', '900.55'),
      fila('TARJETA_CREDITO', 'ARS', '100.45'),
    ])
    expect(total).toBe('1001')
  })

  it('no declara dólares cuando todo entró en pesos', () => {
    expect(componerPorMedio([fila('EFECTIVO', 'ARS', '900')]).hayDolares).toBe(false)
  })

  it('redondea cada pago antes de sumarlo, igual que el total de la venta', () => {
    // Sumar primero y redondear al final da otro número, y este panel se compara
    // contra el tile "Total del período" que sale de la columna `total` de las
    // ventas — que se armó con este mismo redondeo en `totalDePagos`. Si los dos
    // no redondean en el mismo momento, la pantalla se contradice por centavos.
    const { total } = componerPorMedio([
      fila('EFECTIVO', 'USD', '1', '0.005'),
      fila('TRANSFERENCIA', 'USD', '1', '0.005'),
    ])
    expect(total).toBe('0.02')
  })
})
