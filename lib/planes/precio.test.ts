import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { precioConPlan } from './precio'
import { recargoDePago } from '@/lib/ventas/totales'

const d = (v: string) => new Prisma.Decimal(v)

describe('precioConPlan', () => {
  it('un artículo de 10.000 al 40 % se cobra 14.000', () => {
    expect(precioConPlan(d('10000'), d('40')).toString()).toBe('14000')
  })

  it('con un descuento del 10 % se cobra menos', () => {
    expect(precioConPlan(d('10000'), d('-10')).toString()).toBe('9000')
  })

  // Que sea LA MISMA cuenta que hace el motor no es cosmético: si la ficha del
  // artículo dijera un peso más que lo que después cobra el mostrador, el dato
  // que el cliente pidió ver sería justamente el que no sirve.
  it('es exactamente precio + recargoDePago(precio)', () => {
    for (const [precio, pct] of [['12345.67', '13.75'], ['0.01', '999.999'], ['999.99', '-33.333']]) {
      expect(precioConPlan(d(precio), d(pct)).toString()).toBe(
        d(precio).add(recargoDePago(d(precio), d(pct))).toString(),
      )
    }
  })
})
