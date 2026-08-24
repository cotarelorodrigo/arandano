import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Prisma } from '@/generated/prisma/client'
import { formatearPrecio } from '@/lib/formato/mostrar'
import {
  ChipMotivo,
  textoDeMotivo,
  formatearFechaMovimiento,
  detalleDeMovimiento,
  calcularSaldos,
} from './historial'

const d = (v: string) => new Prisma.Decimal(v)

describe('calcularSaldos (Task 5 del rediseño: la columna "Queda")', () => {
  // El caso encadenado del relevamiento (sección 1.c), en el mismo orden en
  // que la consulta real trae los movimientos: `creadoEn desc`, o sea del más
  // nuevo al más viejo. HOkal (venta, -1) es el más nuevo y deja el stock en
  // 48 — el mismo número que el tile "En stock". VukbC (ingreso, +24) queda
  // en 49; s8WsU (ajuste, -3) en 25; S2LS3L (anulación, +1) en 28. Los cuatro
  // saldos encadenan exacto: 48-(-1)=49, 49-24=25, 25-(-3)=28.
  it('cierra contra el stock actual recorriendo los deltas hacia atrás', () => {
    const deltasDesc = [d('-1'), d('24'), d('-3'), d('1')]
    const saldos = calcularSaldos(deltasDesc, d('48'))
    expect(saldos.map((s) => s.toString())).toEqual(['48', '49', '25', '28'])
  })

  it('sin movimientos, no rompe: da un arreglo vacío', () => {
    expect(calcularSaldos([], d('48'))).toEqual([])
  })

  it('un solo movimiento: su saldo ES el stock actual', () => {
    const saldos = calcularSaldos([d('5')], d('10'))
    expect(saldos[0].toString()).toBe('10')
  })
})

describe('detalleDeMovimiento (Task 5 del rediseño: la celda "Detalle")', () => {
  const usuario = { nombre: 'Florencia' }

  it('VENTA: número de venta y quién la hizo', () => {
    expect(
      detalleDeMovimiento({
        motivo: 'VENTA', nota: null, costoUnitario: null, usuario, venta: { numero: 1042 },
      }),
    ).toBe('Venta #1042 · Florencia')
  })

  it('ANULACION_VENTA: sólo el número de venta, sin el usuario', () => {
    expect(
      detalleDeMovimiento({
        motivo: 'ANULACION_VENTA', nota: null, costoUnitario: null, usuario, venta: { numero: 1002 },
      }),
    ).toBe('Anulación de la venta #1002')
  })

  it('INGRESO con nota y costo: los combina, sin nombrar a quién lo hizo', () => {
    const texto = detalleDeMovimiento({
      motivo: 'INGRESO',
      nota: 'Factura A 0001-00023145',
      costoUnitario: d('7400'),
      usuario,
      venta: null,
    })
    // formatearPrecio() y no un literal con espacio a mano: Intl mete un
    // espacio de no separación (NBSP) entre "$" y el número, y un literal
    // con espacio normal nunca iguala byte a byte.
    expect(texto).toBe(`Factura A 0001-00023145 · ${formatearPrecio('7400')} c/u`)
  })

  it('INGRESO sin nota ni costo: cae a quién lo hizo, la celda no queda vacía', () => {
    expect(
      detalleDeMovimiento({ motivo: 'INGRESO', nota: null, costoUnitario: null, usuario, venta: null }),
    ).toBe('Ingreso · Florencia')
  })

  it('AJUSTE con nota: nota y quién contó', () => {
    expect(
      detalleDeMovimiento({
        motivo: 'AJUSTE', nota: 'Conteo de fin de mes', costoUnitario: null, usuario, venta: null,
      }),
    ).toBe('Conteo de fin de mes · Florencia')
  })

  it('AJUSTE sin nota: sólo quién contó', () => {
    expect(
      detalleDeMovimiento({ motivo: 'AJUSTE', nota: null, costoUnitario: null, usuario, venta: null }),
    ).toBe('Florencia')
  })
})

describe('formatearFechaMovimiento', () => {
  it('día y mes con cero a la izquierda, sin año, unidos a la hora con " · "', () => {
    // 21/08/2026 14:28 en Buenos Aires (UTC-3) es las 17:28 UTC.
    expect(formatearFechaMovimiento(new Date('2026-08-21T17:28:00Z'))).toBe('21/08 · 14:28')
  })
})

describe('ChipMotivo', () => {
  it.each([
    ['VENTA', 'Venta'],
    ['INGRESO', 'Ingreso'],
    ['AJUSTE', 'Ajuste'],
    ['ANULACION_VENTA', 'Anulación'],
  ])('%s se ve como "%s"', (motivo, texto) => {
    expect(renderToStaticMarkup(<ChipMotivo motivo={motivo} />)).toContain(texto)
  })

  it('un motivo desconocido no revienta: se ve como texto plano', () => {
    expect(renderToStaticMarkup(<ChipMotivo motivo="OTRO" />)).toContain('OTRO')
  })
})

describe('textoDeMotivo', () => {
  it('devuelve el texto plano, sin ícono', () => {
    expect(textoDeMotivo('VENTA')).toBe('Venta')
    expect(textoDeMotivo('ANULACION_VENTA')).toBe('Anulación')
  })
})
