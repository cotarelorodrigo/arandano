import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import {
  aCentavos, aMilesimas, aDiezMilesimas, deCentavos,
  subtotalEnCentavos, totalEnCentavos,
  pesosDePagoEnCentavos, totalDePagosEnCentavos,
} from './centavos'
import { totalDeItems, totalDePagos } from './totales'

describe('conversión a enteros', () => {
  it('lee el toString de un Decimal de plata', () => {
    expect(aCentavos('1500.5')).toBe(150050)
    expect(aCentavos('1500')).toBe(150000)
    expect(aCentavos('0.05')).toBe(5)
    expect(aCentavos('0')).toBe(0)
  })

  it('lee el toString de un Decimal de cantidad', () => {
    expect(aMilesimas('2')).toBe(2000)
    expect(aMilesimas('0.5')).toBe(500)
    expect(aMilesimas('1.125')).toBe(1125)
  })

  // La cotización tiene CUATRO decimales, no tres: convertirla con aMilesimas
  // truncaría el último y desalinearía el total del botón respecto del servidor.
  it('lee el toString de una cotización, con sus cuatro decimales', () => {
    expect(aDiezMilesimas('1')).toBe(10000)
    expect(aDiezMilesimas('1234.5678')).toBe(12345678)
    expect(aDiezMilesimas('0.0001')).toBe(1)
  })

  it('vuelve a texto con dos decimales, que es como se guarda', () => {
    expect(deCentavos(150050)).toBe('1500.50')
    expect(deCentavos(5)).toBe('0.05')
    expect(deCentavos(0)).toBe('0.00')
  })
})

describe('subtotal', () => {
  it('multiplica y redondea a centavos', () => {
    // 3 × 1500,50 = 4501,50
    expect(subtotalEnCentavos(3000, 150050)).toBe(450150)
  })

  it('redondea medio centavo para arriba, como el servidor', () => {
    // 0,5 × 0,05 = 0,025 -> 0,03 con ROUND_HALF_UP
    expect(subtotalEnCentavos(500, 5)).toBe(3)
  })
})

describe('pagos', () => {
  it('un pago en pesos vale su monto', () => {
    expect(pesosDePagoEnCentavos(150050, 10000)).toBe(150050)
  })

  it('un pago en dólares vale monto × cotización', () => {
    // US$ 0,80 a 1250 = $1000
    expect(pesosDePagoEnCentavos(80, 12500000)).toBe(100000)
  })

  it('no pierde el cuarto decimal de la cotización', () => {
    // US$ 100 a 1234,5678 = $123456,78
    expect(pesosDePagoEnCentavos(10000, 12345678)).toBe(12345678)
  })
})

// El test que justifica el archivo: si estas dos aritméticas se separan, el
// botón se habilita para una venta que el motor rechaza.
describe('coincide con la del servidor', () => {
  const casos = [
    [['3', '1500.50'], ['1', '0.05']],
    [['0.5', '0.05'], ['0.333', '99.99']],
    [['2.125', '1234.56']],
    [['1', '0.01'], ['1', '0.01'], ['1', '0.01']],
  ]

  it.each(casos)('da el mismo total que totalDeItems: %j', (...lineas) => {
    const delServidor = totalDeItems(
      lineas.map(([c, p]) => ({
        cantidad: new Prisma.Decimal(c),
        precioUnitario: new Prisma.Decimal(p),
      })),
    )
    const delCliente = totalEnCentavos(
      lineas.map(([c, p]) => ({ cantidadMilesimas: aMilesimas(c), precioCentavos: aCentavos(p) })),
    )
    expect(deCentavos(delCliente)).toBe(delServidor.toFixed(2))
  })

  const casosDePago: [string, string][][] = [
    [['1000', '1']],
    [['0.8', '1250']],
    [['100', '1234.5678']],
    [['500', '1'], ['0.4', '1250']],
  ]

  it.each(casosDePago)('da el mismo total que totalDePagos: %j', (...pagos) => {
    const delServidor = totalDePagos(
      pagos.map(([m, c]) => ({
        monto: new Prisma.Decimal(m),
        cotizacion: new Prisma.Decimal(c),
      })),
    )
    const delCliente = totalDePagosEnCentavos(
      pagos.map(([m, c]) => ({ montoCentavos: aCentavos(m), cotizacionDiezMilesimas: aDiezMilesimas(c) })),
    )
    expect(deCentavos(delCliente)).toBe(delServidor.toFixed(2))
  })
})
