import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Prisma } from '@/generated/prisma/client'
import { estadoDeFila, ChipEstado, STOCK_BAJO_UMBRAL } from './chip-estado'

const d = (v: string) => new Prisma.Decimal(v)

describe('estadoDeFila', () => {
  it('un producto con stock negativo es NEGATIVO', () => {
    expect(estadoDeFila({ tipo: 'PRODUCTO', stock: d('-2'), desactivado: false })).toBe('NEGATIVO')
  })

  it(`menos de ${STOCK_BAJO_UMBRAL} pero más de cero es QUEDA_POCO`, () => {
    expect(estadoDeFila({ tipo: 'PRODUCTO', stock: d('3'), desactivado: false })).toBe('QUEDA_POCO')
  })

  // El borde que el brief pide explícitamente: cero no es "queda poco", ya no
  // queda nada — son dos avisos distintos.
  it('stock en cero no es QUEDA_POCO', () => {
    expect(estadoDeFila({ tipo: 'PRODUCTO', stock: d('0'), desactivado: false })).toBeNull()
  })

  it(`el umbral no incluye ${STOCK_BAJO_UMBRAL} unidades: a partir de ahí ya no avisa`, () => {
    expect(estadoDeFila({ tipo: 'PRODUCTO', stock: d(String(STOCK_BAJO_UMBRAL)), desactivado: false })).toBeNull()
  })

  it('un stock cómodo no lleva chip', () => {
    expect(estadoDeFila({ tipo: 'PRODUCTO', stock: d('48'), desactivado: false })).toBeNull()
  })

  // Prioridad de display: desactivado gana siempre, incluso con stock
  // negativo o bajo — es historia en ese punto, no una alerta de reponer.
  it('desactivado gana por sobre negativo y queda poco', () => {
    expect(estadoDeFila({ tipo: 'PRODUCTO', stock: d('-5'), desactivado: true })).toBe('DESACTIVADO')
    expect(estadoDeFila({ tipo: 'PRODUCTO', stock: d('2'), desactivado: true })).toBe('DESACTIVADO')
  })

  it('un servicio nunca lleva chip de stock, aunque esté "en negativo"', () => {
    expect(estadoDeFila({ tipo: 'SERVICIO', stock: d('0'), desactivado: false })).toBeNull()
  })

  it('un servicio desactivado sí muestra el chip de desactivado', () => {
    expect(estadoDeFila({ tipo: 'SERVICIO', stock: d('0'), desactivado: true })).toBe('DESACTIVADO')
  })
})

describe('ChipEstado', () => {
  it('NEGATIVO se ve como "Stock negativo"', () => {
    expect(renderToStaticMarkup(<ChipEstado estado="NEGATIVO" />)).toContain('Stock negativo')
  })

  it('QUEDA_POCO se ve como "Queda poco"', () => {
    expect(renderToStaticMarkup(<ChipEstado estado="QUEDA_POCO" />)).toContain('Queda poco')
  })

  it('DESACTIVADO se ve como "Desactivado"', () => {
    expect(renderToStaticMarkup(<ChipEstado estado="DESACTIVADO" />)).toContain('Desactivado')
  })

  // El chip sólo sale con "Ver desactivados" tildado: eso lo garantiza
  // construirDonde() en page.tsx (excluye desactivados por default), no este
  // componente — pero acá sí se puede cablear la otra mitad del contrato: sin
  // estado, no hay ningún chip que mostrar.
  it('sin estado, no renderiza nada', () => {
    expect(renderToStaticMarkup(<ChipEstado estado={null} />)).toBe('')
  })
})
