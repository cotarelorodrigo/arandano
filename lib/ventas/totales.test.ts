import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import {
  redondearDinero,
  subtotalItem,
  totalDeItems,
  montoEnPesos,
  totalDePagos,
  recargoDePago,
  totalCobrado,
  baseEnDolares,
  aporteDePago,
  montoEntregado,
  totalesDeItems,
  totalesDePagos,
  pesosEntregados,
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

  it('redondea cada pago antes de sumar', () => {
    const total = totalDePagos([
      { monto: d('3'), cotizacion: d('0.005') },
      { monto: d('3'), cotizacion: d('0.005') },
    ])
    // Redondear primero: 0,015 -> 0,02 por pago, 0,02 + 0,02 = 0,04.
    // Sumar primero daría 0,015 + 0,015 = 0,03 antes de redondear, y esa
    // diferencia de un centavo es la misma venta rechazada por no cerrar
    // contra el total de los ítems (ver el caso equivalente en
    // 'totalDeItems'): acá se ancla del lado de los pagos.
    expect(total.toString()).toBe('0.04')
  })

  it('una lista vacía da cero', () => {
    expect(totalDePagos([]).toString()).toBe('0')
  })
})

describe('recargoDePago', () => {
  it('un recargo del 25 % sobre 100.000 son 25.000', () => {
    expect(recargoDePago(d('100000'), d('25')).toString()).toBe('25000')
  })

  it('un descuento del 10 % es negativo', () => {
    expect(recargoDePago(d('10000'), d('-10')).toString()).toBe('-1000')
  })

  it('un porcentaje en cero no recarga', () => {
    expect(recargoDePago(d('9999.99'), d('0')).toString()).toBe('0')
  })

  // ROUND_HALF_UP: 0.005 va para arriba, y para un negativo "arriba" es
  // alejarse del cero. Es lo que hace el resto del motor y lo que la gente
  // espera cuando mira el vuelto.
  //
  // 1 y 0,5 % NO son números redondos elegidos al azar: 1 × 0,5 / 100 = 0,005
  // exacto, la mitad exacta de un centavo — el único valor que de verdad
  // ejercita el desempate de ROUND_HALF_UP. Un par más "prolijo" como 1 y 50 %
  // da 0,5, que ya es exacto a dos decimales y no prueba nada (fue el bug que
  // este mismo test tenía antes de esta corrección). No simplificar de vuelta.
  it('redondea la mitad alejándose del cero, en los dos signos', () => {
    expect(recargoDePago(d('1'), d('0.5')).toString()).toBe('0.01')
    expect(recargoDePago(d('1'), d('-0.5')).toString()).toBe('-0.01')
  })

  it('respeta los tres decimales del porcentaje', () => {
    expect(recargoDePago(d('10000'), d('13.75')).toString()).toBe('1375')
  })
})

describe('totalCobrado', () => {
  // Es lo que preguntan la columna Total y el tile "Total del período" de
  // /ventas: cuánto entró, no cuánto valía la mercadería.
  it('suma el recargo al total de mercadería', () => {
    expect(totalCobrado({ total: d('10000'), recargo: d('2500') }).toString()).toBe('12500')
  })

  it('un recargo negativo (descuento) resta', () => {
    expect(totalCobrado({ total: d('10000'), recargo: d('-1000') }).toString()).toBe('9000')
  })

  it('sin recargo, lo cobrado es exactamente la mercadería', () => {
    // Toda venta grabada antes de este ciclo tiene recargo 0 (Task 4: "sin
    // plan, todo sigue exactamente como antes") — éste es el caso que
    // describe a todas ellas.
    expect(totalCobrado({ total: d('10000'), recargo: d('0') }).toString()).toBe('10000')
  })
})

describe('baseEnDolares', () => {
  it('es falso sólo cuando ninguna de las dos puntas toca dólares', () => {
    expect(baseEnDolares({ moneda: 'ARS', cubre: 'ARS' })).toBe(false)
    expect(baseEnDolares({ moneda: 'USD', cubre: 'ARS' })).toBe(true)
    expect(baseEnDolares({ moneda: 'USD', cubre: 'USD' })).toBe(true)
    expect(baseEnDolares({ moneda: 'ARS', cubre: 'USD' })).toBe(true)
  })
})

describe('aporteDePago', () => {
  it('pesos cubriendo pesos aporta su base', () => {
    const p = { moneda: 'ARS' as const, cubre: 'ARS' as const, base: d('15000'), cotizacion: d('1') }
    expect(aporteDePago(p).toString()).toBe('15000')
    expect(montoEntregado(p).toString()).toBe('15000')
  })

  it('dólares cubriendo pesos aporta base × cotización, y se entregan los dólares', () => {
    const p = { moneda: 'USD' as const, cubre: 'ARS' as const, base: d('300'), cotizacion: d('1485') }
    expect(aporteDePago(p).toString()).toBe('445500')
    expect(montoEntregado(p).toString()).toBe('300')
  })

  it('dólares cubriendo dólares aporta su base, sin cotización de por medio', () => {
    const p = { moneda: 'USD' as const, cubre: 'USD' as const, base: d('300'), cotizacion: d('1') }
    expect(aporteDePago(p).toString()).toBe('300')
    expect(montoEntregado(p).toString()).toBe('300')
  })

  it('pesos cubriendo dólares aporta los DÓLARES de la base, y se entregan los pesos', () => {
    // El caso del feedback: la base se tipea en dólares y el peso se
    // MULTIPLICA. Si algún día esto divide, está mal.
    const p = { moneda: 'ARS' as const, cubre: 'USD' as const, base: d('300'), cotizacion: d('1485') }
    expect(aporteDePago(p).toString()).toBe('300')
    expect(montoEntregado(p).toString()).toBe('445500')
  })
})

describe('totalesDeItems', () => {
  it('parte el carrito por moneda y redondea cada línea antes de sumar', () => {
    const t = totalesDeItems([
      { cantidad: d('2'), precioUnitario: d('7500'), moneda: 'ARS' },
      { cantidad: d('1'), precioUnitario: d('300'), moneda: 'USD' },
      { cantidad: d('3'), precioUnitario: d('0.335'), moneda: 'ARS' },
    ])
    // 15000 + 1.01 (0.335×3 = 1.005 → 1.01 con ROUND_HALF_UP)
    expect(t.ars.toString()).toBe('15001.01')
    expect(t.usd.toString()).toBe('300')
  })

  it('un carrito vacío da cero en las dos monedas', () => {
    const t = totalesDeItems([])
    expect(t.ars.toString()).toBe('0')
    expect(t.usd.toString()).toBe('0')
  })
})

describe('totalesDePagos', () => {
  it('acumula cada pago contra el total que declara cubrir', () => {
    const t = totalesDePagos([
      { moneda: 'USD', cubre: 'USD', base: d('300'), cotizacion: d('1') },
      { moneda: 'ARS', cubre: 'ARS', base: d('15000'), cotizacion: d('1') },
      { moneda: 'USD', cubre: 'ARS', base: d('10'), cotizacion: d('1485') },
    ])
    expect(t.usd.toString()).toBe('300')
    expect(t.ars.toString()).toBe('29850')
  })
})

describe('pesosEntregados', () => {
  it('un pago en pesos vale su monto, aunque su cotización no sea 1', () => {
    // Un pago en pesos que cubre el total en dólares lleva `cotizacion = 1485`
    // y `monto` YA en pesos: multiplicarlo otra vez daba 926 millones.
    expect(
      pesosEntregados({ moneda: 'ARS', monto: d('623700'), cotizacion: d('1485') }).toString(),
    ).toBe('623700')
  })

  it('un pago en dólares vale monto × cotización', () => {
    expect(
      pesosEntregados({ moneda: 'USD', monto: d('300'), cotizacion: d('1485') }).toString(),
    ).toBe('445500')
  })
})
