import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import {
  redondearDinero,
  subtotalItem,
  totalDeItems,
  montoEnPesos,
  totalDePagos,
} from './totales'

const d = (v: string) => new Prisma.Decimal(v)

describe('redondearDinero', () => {
  it('deja dos decimales', () => {
    expect(redondearDinero(d('10.005')).toString()).toBe('10.01')
    expect(redondearDinero(d('10.004')).toString()).toBe('10')
  })

  it('redondea el medio hacia arriba', () => {
    expect(redondearDinero(d('0.125')).toString()).toBe('0.13')
    expect(redondearDinero(d('0.135')).toString()).toBe('0.14')
  })
})

describe('subtotalItem', () => {
  it('multiplica y redondea', () => {
    expect(subtotalItem(d('3'), d('1500.50')).toString()).toBe('4501.5')
  })

  it('soporta cantidades fraccionarias', () => {
    // Medio kilo a 2999,99: el caso de gastronomía que motivó el Decimal(12,3).
    expect(subtotalItem(d('0.5'), d('2999.99')).toString()).toBe('1500')
  })
})

describe('totalDeItems', () => {
  it('suma los subtotales ya redondeados', () => {
    const total = totalDeItems([
      { cantidad: d('3'), precioUnitario: d('0.005') },
      { cantidad: d('3'), precioUnitario: d('0.005') },
    ])
    // Redondear primero: 0,02 + 0,02 = 0,04.
    // Sumar primero daría 0,03, y esa diferencia de un centavo es una venta
    // rechazada por no cerrar contra los pagos.
    expect(total.toString()).toBe('0.04')
  })

  it('una lista vacía da cero', () => {
    expect(totalDeItems([]).toString()).toBe('0')
  })
})

describe('montoEnPesos', () => {
  it('un pago en pesos lleva cotización 1', () => {
    expect(montoEnPesos(d('1500.50'), d('1')).toString()).toBe('1500.5')
  })

  it('convierte con la cotización guardada', () => {
    expect(montoEnPesos(d('100'), d('1350.7500')).toString()).toBe('135075')
  })
})

describe('totalDePagos', () => {
  it('suma pago partido en dos monedas', () => {
    const total = totalDePagos([
      { monto: d('50000'), cotizacion: d('1') },
      { monto: d('100'), cotizacion: d('1350.7500') },
    ])
    expect(total.toString()).toBe('185075')
  })

  it('una lista vacía da cero', () => {
    expect(totalDePagos([]).toString()).toBe('0')
  })
})
