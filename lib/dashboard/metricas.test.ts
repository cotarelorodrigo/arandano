import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { delta, margenDe } from './metricas'

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

  // Minor 2 de la review de esta task: una baja MÍNIMA redondea a "-0", y en
  // JS `-0 >= 0` da `true` — el chip se dibujaba subiendo, en verde, al lado
  // de un número que en realidad bajó. El signo tiene que salir de comparar
  // actual/previo SIN redondear, no del redondeado.
  it('una baja mínima que redondea a "-0" sigue siendo una baja', () => {
    const r = delta(d('1000000'), d('1000300'))
    expect(r?.sube).toBe(false)
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

// SIN describe de mediana, a propósito: `indicesDeMediana` y `medianaDeVentas`
// se borraron (Ruling M de la review de esta task — ver el comentario donde
// vivía en metricas.ts para el motivo y el disparador para traerla de vuelta).
