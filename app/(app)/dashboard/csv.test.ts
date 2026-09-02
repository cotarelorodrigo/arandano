import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { ENCABEZADO_CSV, filaDeVenta } from './csv'

describe('ENCABEZADO_CSV', () => {
  it('nombra las dos monedas por separado', () => {
    expect(ENCABEZADO_CSV).toContain('Vendido ARS')
    expect(ENCABEZADO_CSV).toContain('Vendido USD')
    expect(ENCABEZADO_CSV).toContain('Cobrado ARS')
    expect(ENCABEZADO_CSV).toContain('Cobrado USD')
  })

  // Minor 3 de la review: `toContain` sobre un array es membresía EXACTA de
  // un elemento — una columna futura llamada "Costo unitario" pasaría igual
  // un `.not.toContain('Costo')` sin decir nada, porque ningún elemento del
  // array es exactamente la cadena "Costo". Contra el string JOINEADO y con
  // `\b` sí detecta la palabra dentro de una columna más larga. Dicho así de
  // explícito porque igual no es la garantía real: la garantía real es que
  // `exportarVentas` (./acciones.ts) nunca pide `costoUnitario` en su
  // `select` — esto es un smoke check sobre los NOMBRES, no sobre los datos.
  it('no lleva costo ni margen en ningún encabezado, aunque quien lo baje tenga COSTOS', () => {
    const encabezadoUnido = ENCABEZADO_CSV.join(' ')
    expect(encabezadoUnido).not.toMatch(/\bCosto\b/)
    expect(encabezadoUnido).not.toMatch(/\bMargen\b/)
  })
})

const DECIMAL = (v: string) => new Prisma.Decimal(v)

/** Una venta mínima válida para `filaDeVenta`, con overrides. */
function venta(over: Partial<Parameters<typeof filaDeVenta>[0]> = {}) {
  return {
    numero: 1042,
    creadoEn: new Date('2026-08-21T17:28:00Z'), // 14:28 en America/Argentina
    total: DECIMAL('50000'),
    totalUsd: DECIMAL('0'),
    recargo: DECIMAL('0'),
    anuladaEn: null,
    cliente: { nombre: 'Ana Pérez' },
    pagos: [{ medio: 'EFECTIVO' as const, moneda: 'ARS' as const, monto: DECIMAL('50000') }],
    ...over,
  }
}

describe('filaDeVenta: una venta -> las once columnas de ENCABEZADO_CSV', () => {
  it('arma número, fecha, hora, cliente, medios y los cuatro importes por moneda', () => {
    const fila = filaDeVenta(venta())
    expect(fila).toHaveLength(ENCABEZADO_CSV.length)
    expect(fila[0]).toBe('1042')
    // Minor 4 de la review: Fecha y Hora estaban en el fixture (el comentario
    // "14:28 en America/Argentina") pero nadie las afirmaba — un comentario
    // que promete una garantía que el fixture nunca ejercita. `formatearFecha
    // Corta`/`formatearHora` ya convierten UTC a America/Argentina/Buenos_Aires
    // (ver lib/formato/mostrar.ts), así que 17:28 UTC tiene que leerse acá
    // como 14:28 local.
    expect(fila[1]).toBe('21/08/2026') // Fecha
    expect(fila[2]).toBe('14:28') // Hora
    expect(fila[3]).toBe('Ana Pérez')
    expect(fila[4]).toBe('Efectivo')
    expect(fila[5]).toContain('50.000') // Vendido ARS
    expect(fila[7]).toContain('50.000') // Cobrado ARS
    expect(fila[10]).toBe('Cobrada')
  })

  // Sin esto, "Estado" podría afirmar "Cobrada" para una venta que ya se
  // devolvió — es la columna que un contador usa para no sumarla dos veces.
  it('una venta anulada dice "Anulada", no "Cobrada"', () => {
    const fila = filaDeVenta(venta({ anuladaEn: new Date('2026-08-22T10:00:00Z') }))
    expect(fila[10]).toBe('Anulada')
  })

  // Sin cliente asociado (venta de mostrador), la celda no queda vacía: usa
  // el mismo literal "Consumidor final" que ya muestra /ventas.
  it('sin cliente asociado, la celda dice "Consumidor final"', () => {
    const fila = filaDeVenta(venta({ cliente: null }))
    expect(fila[3]).toBe('Consumidor final')
  })

  // El caso del ciclo "cobrado por moneda" (CLAUDE.md): un iPhone de US$ 300
  // cobrado con US$ 200 + pesos. "Vendido" tiene que seguir diciendo la
  // mercadería (US$ 300) y "Cobrado" lo que entró en cada moneda por
  // separado — nada se convierte entre las dos columnas.
  it('vendido y cobrado no se confunden cuando difieren (plan de pago, venta mixta)', () => {
    const fila = filaDeVenta(
      venta({
        total: DECIMAL('0'),
        totalUsd: DECIMAL('300'),
        recargo: DECIMAL('29700'),
        pagos: [
          { medio: 'TARJETA_CREDITO', moneda: 'USD', monto: DECIMAL('200') },
          { medio: 'EFECTIVO', moneda: 'ARS', monto: DECIMAL('178200') },
        ],
      }),
    )
    expect(fila[5]).toBe('$ 0,00') // Vendido ARS: nada de mercadería en pesos
    expect(fila[6]).toContain('300') // Vendido USD: la mercadería, sin convertir
    expect(fila[7]).toContain('178.200') // Cobrado ARS: lo que entró en pesos
    expect(fila[8]).toContain('200') // Cobrado USD: lo que entró en dólares
    expect(fila[9]).toContain('29.700') // Recargo, siempre en pesos
  })
})
