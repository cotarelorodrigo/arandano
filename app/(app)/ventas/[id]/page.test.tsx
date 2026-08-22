// Puro: importa sólo las funciones exportadas de page.tsx, nunca el
// componente en sí — es un Server Component async que abre sesión y consulta
// Prisma (mismo criterio que app/(app)/ventas/page.test.tsx, que documenta
// el porqué con más detalle).
import { describe, it, expect } from 'vitest'
import {
  puedeAnular, cotizacionVisible, subtituloDeItem, filasDeResumen,
} from './page'
import { CONSUMIDOR_FINAL } from '@/lib/ventas/medios'

describe('puedeAnular', () => {
  it('el dueño puede anular una venta cobrada', () => {
    expect(puedeAnular('DUENO', null)).toBe(true)
  })

  it('un empleado no ve el botón, sin importar el estado de la venta', () => {
    expect(puedeAnular('EMPLEADO', null)).toBe(false)
  })

  it('nadie anula una venta ya anulada, ni siquiera el dueño', () => {
    expect(puedeAnular('DUENO', new Date())).toBe(false)
  })
})

describe('cotizacionVisible', () => {
  it('un pago en pesos no tiene cotización que mostrar', () => {
    expect(cotizacionVisible({ moneda: 'ARS', cotizacion: '1' })).toBe('—')
  })

  it('un pago en dólares muestra la cotización con la que se tomó', () => {
    const salida = cotizacionVisible({ moneda: 'USD', cotizacion: '1485' })
    expect(salida).toContain('1.485,00')
  })
})

describe('subtituloDeItem', () => {
  it('un producto muestra su SKU', () => {
    expect(subtituloDeItem({ sku: '000412', tipo: 'PRODUCTO' })).toBe('SKU 000412')
  })

  it('un servicio no tiene SKU de stock: dice "Servicio"', () => {
    expect(subtituloDeItem({ sku: '999999', tipo: 'SERVICIO' })).toBe('Servicio')
  })
})

describe('filasDeResumen', () => {
  it('arma fecha, vendió, cliente y comprobante (estado va aparte, en ChipEstado)', () => {
    // 20:28 UTC son las 17:28 en Buenos Aires (UTC-3) — no coinciden con el
    // ejemplo del relevamiento a propósito, para no depender de que alguien
    // reafirme el mismo número dos veces sin mirar el huso.
    const filas = filasDeResumen({
      creadoEn: new Date('2026-08-21T20:28:00Z'),
      usuario: { nombre: 'Florencia Díaz' },
      cliente: null,
    })
    expect(filas.vendio).toBe('Florencia Díaz')
    expect(filas.cliente).toBe(CONSUMIDOR_FINAL)
    expect(filas.comprobante).toBe('Sin factura ARCA')
    expect(filas.fecha).toBe('21/08/2026 · 17:28')
  })

  it('con cliente identificado, muestra su nombre y no "Consumidor final"', () => {
    const filas = filasDeResumen({
      creadoEn: new Date(),
      usuario: { nombre: 'Alguien' },
      cliente: { nombre: 'Martín Sosa' },
    })
    expect(filas.cliente).toBe('Martín Sosa')
  })
})
