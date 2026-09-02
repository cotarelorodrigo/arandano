import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { filaCsv, ENCABEZADO_CSV, filaDeVenta } from './acciones'

describe('el CSV escapa por RFC 4180', () => {
  it('encomilla lo que lleva coma, comilla o salto de línea', () => {
    expect(filaCsv(['1042', 'Pérez, Ana', 'dijo "hola"'])).toBe(
      '1042,"Pérez, Ana","dijo ""hola"""',
    )
  })

  it('deja pasar lo que no necesita comillas', () => {
    expect(filaCsv(['1042', 'Efectivo'])).toBe('1042,Efectivo')
  })

  it('el encabezado nombra las dos monedas por separado', () => {
    expect(ENCABEZADO_CSV).toContain('Vendido ARS')
    expect(ENCABEZADO_CSV).toContain('Vendido USD')
    expect(ENCABEZADO_CSV).toContain('Cobrado ARS')
    expect(ENCABEZADO_CSV).toContain('Cobrado USD')
    // No lleva costo ni margen aunque quien lo baje tenga COSTOS: un CSV sale
    // del sistema y sigue circulando.
    expect(ENCABEZADO_CSV).not.toContain('Costo')
    expect(ENCABEZADO_CSV).not.toContain('Margen')
  })

  // Un nombre que arranca con "=" es el caso real de CSV injection (guía de
  // OWASP), no de laboratorio: cualquier cliente cargado así alcanza para
  // dispararlo en cuanto tenga una venta en el período.
  it('neutraliza una celda que arranca con =, +, - o @ para que una planilla no la lea como fórmula', () => {
    expect(filaCsv(['=HOY()'])).toBe("'=HOY()")
    expect(filaCsv(['+1', '-1', '@x'])).toBe("'+1,'-1,'@x")
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
