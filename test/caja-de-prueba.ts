import type { CajaDelChip } from '@/app/(app)/vender/caja'

const CERO = { ars: '0.00', usd: '0.00' }

/**
 * Un turno de caja abierto para los tests que renderizan `/vender`: sin
 * dólares, sin movimientos, y con el efectivo que se le pase (por defecto, el
 * ejemplo del pedido del cliente: $ 55.000).
 *
 * Existe desde el ciclo del arqueo (2026-10-18), cuando `CajaDelChip` dejó de
 * ser sólo `{ abiertaEn }`: armarlo a mano en cada test era copiar ocho
 * campos que a la mayoría de los casos no le importan.
 */
export function cajaDePrueba(c: Partial<CajaDelChip> = {}): CajaDelChip {
  return {
    abiertaEn: new Date('2026-08-21T17:32:00Z'),
    abiertaPor: 'Flor',
    conDolares: false,
    efectivo: {
      apertura: { ars: '10000.00', usd: '0.00' },
      cobrado: { ars: '50000.00', usd: '0.00' },
      devuelto: CERO,
      ingresos: CERO,
      egresos: { ars: '5000.00', usd: '0.00' },
      retiros: CERO,
      actual: { ars: '55000.00', usd: '0.00' },
    },
    movimientos: [],
    ...c,
  }
}
