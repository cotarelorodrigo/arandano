import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { formatearPrecio, montoSinSigno } from '@/lib/formato/mostrar'
import {
  ganancia,
  queFalta,
  fraseDeFalta,
  notaDePlata,
  esEventoDePlata,
  precargaDelCobro,
} from './plata'

const d = (v: string) => new Prisma.Decimal(v)

describe('ganancia', () => {
  it('cobrado menos costo', () => {
    expect(ganancia(d('40000'), d('28000'))?.equals(d('12000'))).toBe(true)
  })
  it('puede ser negativa', () => {
    expect(ganancia(d('10000'), d('15000'))?.equals(d('-5000'))).toBe(true)
  })
  it('es null si falta cualquiera de los dos', () => {
    expect(ganancia(null, d('1'))).toBeNull()
    expect(ganancia(d('1'), null)).toBeNull()
  })
  it('cero es un dato, no una falta', () => {
    expect(ganancia(d('0'), d('0'))?.equals(d('0'))).toBe(true)
  })
})

describe('queFalta', () => {
  it('distingue qué dato falta', () => {
    expect(queFalta(null, null)).toBe('ambos')
    expect(queFalta(d('1'), null)).toBe('costo')
    expect(queFalta(null, d('1'))).toBe('cobrado')
    expect(queFalta(d('0'), d('0'))).toBeNull()
  })
})

describe('fraseDeFalta', () => {
  it('dice qué falta cargar', () => {
    expect(fraseDeFalta('costo')).toBe('Falta cargar el costo')
    expect(fraseDeFalta('cobrado')).toBe('Falta cargar lo cobrado')
    expect(fraseDeFalta('ambos')).toBe('Falta cargar el costo y lo cobrado')
  })
})

describe('notaDePlata', () => {
  it('una línea por campo que cambió', () => {
    expect(notaDePlata({ costo: [d('25000'), d('28000')] })).toBe(
      `Costo: ${formatearPrecio('25000')} → ${formatearPrecio('28000')}`,
    )
  })
  it('un campo sin cargar se lee "sin cargar"', () => {
    expect(notaDePlata({ cobrado: [null, d('40000')] })?.startsWith('Cobrado: sin cargar → ')).toBe(
      true,
    )
  })
  it('une los dos campos con " · "', () => {
    const nota = notaDePlata({ costo: [d('1'), d('2')], cobrado: [d('3'), d('4')] })
    expect(nota).toContain(' · ')
    expect(nota?.startsWith('Costo: ')).toBe(true)
    expect(nota?.split(' · ')[1].startsWith('Cobrado: ')).toBe(true)
  })
  it('null si nada cambió (5 == 5.00, null == null)', () => {
    expect(notaDePlata({ costo: [d('5'), d('5.00')], cobrado: [null, null] })).toBeNull()
    expect(notaDePlata({})).toBeNull()
  })
})

describe('esEventoDePlata', () => {
  it('es el evento donde el estado no cambia', () => {
    expect(esEventoDePlata({ desde: 'LISTO', hasta: 'LISTO' })).toBe(true)
    expect(esEventoDePlata({ desde: null, hasta: 'RECIBIDO' })).toBe(false)
    expect(esEventoDePlata({ desde: 'RECIBIDO', hasta: 'LISTO' })).toBe(false)
  })
})

describe('precargaDelCobro', () => {
  it('prefiere lo cobrado, luego el estimado, luego vacío', () => {
    const cobrado = montoSinSigno(formatearPrecio('40000'))
    const estimado = montoSinSigno(formatearPrecio('35000'))
    expect(precargaDelCobro({ montoCobrado: d('40000'), montoEstimado: d('35000') })).toBe(cobrado)
    expect(precargaDelCobro({ montoCobrado: null, montoEstimado: d('35000') })).toBe(estimado)
    expect(precargaDelCobro({ montoCobrado: null, montoEstimado: null })).toBe('')
  })
})
