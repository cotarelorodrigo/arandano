import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { delta, margenDe, indicesDeMediana } from './metricas'

const d = (v: string) => new Prisma.Decimal(v)

describe('el delta contra el período anterior', () => {
  it('sube y baja con el signo correcto, a un decimal', () => {
    expect(delta(d('312'), d('286'))).toEqual({ porcentaje: 9.1, sube: true })
    expect(delta(d('2398700'), d('2455200'))).toEqual({ porcentaje: -2.3, sube: false })
  })

  // No hay porcentaje de crecimiento contra cero: "+∞ %" y "+100 %" son las
  // dos maneras de inventarlo. El chip no se dibuja y el pie lo dice.
  it('sin período anterior no hay delta', () => {
    expect(delta(d('312'), d('0'))).toBeNull()
  })

  it('de algo a cero sí tiene delta: es −100 %', () => {
    expect(delta(d('0'), d('286'))).toEqual({ porcentaje: -100, sube: false })
  })

  it('sin movimiento el delta es cero y se dibuja igual', () => {
    expect(delta(d('286'), d('286'))).toEqual({ porcentaje: 0, sube: true })
  })
})

describe('el margen divide contra la mercadería CON costo, no contra el total', () => {
  it('el porcentaje sale sobre vendidoConCosto', () => {
    // Vendido con costo 8.416.000, costo 6.017.300 → margen 2.398.700 = 28,5 %
    const m = margenDe(d('8416000'), d('6017300'))
    expect(m?.monto.toString()).toBe('2398700')
    expect(m?.porcentaje.toFixed(1)).toBe('28.5')
  })

  // La diferencia entre "no hay margen" y "el margen es cero": sin ninguna
  // venta con costo cargado el tile muestra una raya y lo explica, no un 0 %.
  it('sin mercadería con costo no hay margen', () => {
    expect(margenDe(d('0'), d('0'))).toBeNull()
  })

  it('un margen negativo es un margen, no una ausencia', () => {
    const m = margenDe(d('1000'), d('1200'))
    expect(m?.monto.toString()).toBe('-200')
    expect(m?.porcentaje.toFixed(1)).toBe('-20.0')
  })
})

describe('la mediana no trae el período entero', () => {
  // Con n impar cruza UNA fila; con n par, dos. Es lo que evita que "Este año"
  // traiga decenas de miles de Decimal para calcular un solo número.
  it('con n impar pide una sola fila, la del medio', () => {
    expect(indicesDeMediana(7)).toEqual({ skip: 3, take: 1 })
    expect(indicesDeMediana(1)).toEqual({ skip: 0, take: 1 })
  })

  it('con n par pide las dos del medio', () => {
    expect(indicesDeMediana(8)).toEqual({ skip: 3, take: 2 })
    expect(indicesDeMediana(2)).toEqual({ skip: 0, take: 2 })
  })

  it('sin ventas no pide nada', () => {
    expect(indicesDeMediana(0)).toBeNull()
  })
})
