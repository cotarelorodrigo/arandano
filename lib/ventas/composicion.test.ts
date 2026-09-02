import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { componerPorMedio, MEDIOS } from './composicion'
import type { FilaDePagos } from './composicion'

const d = (v: string) => new Prisma.Decimal(v)

/** Una fila del `groupBy`: N pagos idénticos de `monto` a `cotizacion`. */
const fila = (
  medio: (typeof MEDIOS)[number],
  moneda: 'ARS' | 'USD',
  monto: string,
  cotizacion = '1',
  _count = 1,
) => ({ medio, moneda, cotizacion: d(cotizacion), monto: d(monto), _count })

describe('componerPorMedio', () => {
  it('sin pagos devuelve las dos pilas vacías', () => {
    expect(componerPorMedio([])).toEqual({
      ars: { barras: [], total: '0' },
      usd: { barras: [], total: '0' },
      hayDolares: false,
    })
  })

  it('dos filas del mismo medio con cotizaciones distintas se combinan en una sola barra, sin convertir', () => {
    // El mismo medio, dos cotizaciones distintas: es exactamente por eso que el
    // groupBy agrupa TAMBIÉN por cotizacion, y lo que este caso protege — que
    // esa fragmentación en dos filas no le impida a componerPorMedio sumarlas
    // en una sola barra. Antes esto convertía a pesos (185.000); ahora la
    // cotización de cada fila no entra en la cuenta: 100 + 50 = 150 dólares.
    const { usd } = componerPorMedio([
      fila('EFECTIVO', 'USD', '100', '1200'),
      fila('EFECTIVO', 'USD', '50', '1300'),
    ])
    expect(usd.barras).toEqual([{ medio: 'EFECTIVO', monto: '150' }])
  })

  it('separa pesos de dólares dentro del mismo medio, cada uno en su pila', () => {
    const c = componerPorMedio([
      fila('EFECTIVO', 'ARS', '5000'),
      fila('EFECTIVO', 'USD', '10', '1200'),
    ])
    expect(c.ars.barras).toEqual([{ medio: 'EFECTIVO', monto: '5000' }])
    expect(c.usd.barras).toEqual([{ medio: 'EFECTIVO', monto: '10' }])
    expect(c.hayDolares).toBe(true)
  })

  it('cada pila ordena de mayor a menor por el monto de la barra', () => {
    const { ars } = componerPorMedio([
      fila('TARJETA_DEBITO', 'ARS', '100'),
      fila('EFECTIVO', 'ARS', '900'),
      fila('TRANSFERENCIA', 'ARS', '500'),
    ])
    expect(ars.barras.map((b) => b.medio)).toEqual(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO'])
  })

  it('omite los medios sin pagos en esa pila en vez de dibujarlos en cero', () => {
    // Una barra de largo cero no dice "no se cobró así": dice "acá falta algo".
    const { ars } = componerPorMedio([fila('EFECTIVO', 'ARS', '900')])
    expect(ars.barras).toHaveLength(1)
  })

  it('el total de cada pila es la suma de sus barras', () => {
    const { ars } = componerPorMedio([
      fila('EFECTIVO', 'ARS', '900.55'),
      fila('TARJETA_CREDITO', 'ARS', '100.45'),
    ])
    expect(ars.total).toBe('1001')
  })

  it('no declara dólares cuando todo entró en pesos', () => {
    expect(componerPorMedio([fila('EFECTIVO', 'ARS', '900')]).hayDolares).toBe(false)
  })

  it('redondea cada pago antes de sumarlo, igual que el total de la venta', () => {
    // Sumar primero y redondear al final da otro número, y este panel se compara
    // contra el tile "Total del período" que sale de la columna `total` de las
    // ventas — que se armó con este mismo redondeo en `totalDePagos`. Si los dos
    // no redondean en el mismo momento, la pantalla se contradice por centavos.
    //
    // Con el monto llevando los decimales de más —ya no la cotización, que
    // dejó de multiplicar—: 1450,5555 redondea a 1450,56 y RECIÉN AHÍ se
    // multiplica por 2 = 2901,12. Sumar primero (1450,5555 × 2 = 2901,111) y
    // redondear al final daría 2901,11.
    const { ars } = componerPorMedio([fila('EFECTIVO', 'ARS', '1450.5555', '1', 2)])
    expect(ars.total).toBe('2901.12')
  })

  it('cuenta los pagos repetidos de un grupo', () => {
    const { ars } = componerPorMedio([fila('EFECTIVO', 'ARS', '1500', '1', 3)])
    expect(ars.barras[0].monto).toBe('4500')
  })

  it('un grupo sin pagos no aporta nada', () => {
    expect(componerPorMedio([fila('EFECTIVO', 'ARS', '1500', '1', 0)]).ars.barras).toEqual([])
  })

  it('un pago en PESOS que cubre el total en dólares va entero a la pila de pesos, sin multiplicar', () => {
    // moneda ARS + cotizacion 1485: `monto` ya está en pesos, y esta función no
    // multiplica NUNCA por la cotización — antes, con `pesosEntregados`, esto
    // dependía de que la función mirara la moneda; ahora ninguna rama lo hace.
    const c = componerPorMedio([
      { medio: 'TARJETA_CREDITO', moneda: 'ARS', monto: d('623700'), cotizacion: d('1485'), _count: 1 },
    ])
    expect(c.ars.total).toBe('623700')
    expect(c.hayDolares).toBe(false)
  })

  it('un pago en PESOS con cotización distinta de 1 no aporta nada a la pila de dólares', () => {
    // El pago que cubre el total en dólares entregando pesos (ciclo del
    // 2026-08-29): lleva la cotización real, 1485, con el monto YA en pesos.
    // Entró en pesos, así que la pila de dólares no lo cuenta — no hay
    // ninguna conversión que lo pase de una pila a la otra.
    const { usd } = componerPorMedio([fila('TARJETA_CREDITO', 'ARS', '623700', '1485')])
    expect(usd.barras).toEqual([])
    expect(usd.total).toBe('0')
  })

  it('multiplica los dólares por la cantidad de pagos del grupo, sin cotización de por medio', () => {
    // El `_count` del groupBy: tres pagos idénticos de US$ 20 son US$ 60.
    const { usd } = componerPorMedio([fila('EFECTIVO', 'USD', '20', '1485', 3)])
    expect(usd.barras[0].monto).toBe('60')
  })
})

describe('ningún pago se valúa por su cotización', () => {
  // Sin `cubre`: FilaDePagos no lo lleva —el groupBy que la alimenta
  // (app/(app)/ventas/page.tsx) agrupa por ['medio','moneda','cotizacion',
  // 'monto'], no por 'cubre'—. Los nombres de cada caso siguen describiendo el
  // escenario que produjo la fila (qué cubría el pago), pero lo que
  // `componerPorMedio` lee de verdad es sólo `(moneda, monto, cotizacion)`.
  const fila = (over: Partial<FilaDePagos>): FilaDePagos => ({
    medio: 'EFECTIVO', moneda: 'ARS',
    cotizacion: d('1'), monto: d('1000'), _count: 1, ...over,
  })

  // EL caso del arreglo. Un iPhone de US$ 300 pagado con 300 dólares en
  // efectivo lleva cotización 1 (cotizacionParaElCruce: el pago no cruza, así
  // que no hay conversión que registrar). Multiplicar por esa cotización daba
  // 300 pesos, y la barra de Efectivo quedaba prácticamente vacía.
  it('un pago USD que cubre USD no aporta NADA a la pila de pesos', () => {
    const c = componerPorMedio([
      fila({ moneda: 'USD', monto: d('300'), cotizacion: d('1') }),
    ])
    expect(c.ars.total).toBe('0')
    expect(c.usd.total).toBe('300')
    expect(c.usd.barras).toEqual([{ medio: 'EFECTIVO', monto: '300' }])
    expect(c.hayDolares).toBe(true)
  })

  // La otra dirección: un pago EN PESOS que cubre el total en dólares lleva la
  // cotización de verdad (1485) con el monto YA en pesos. Va entero a la pila
  // de pesos, sin tocar la cotización.
  it('un pago ARS que cubre USD va entero a pesos, sin multiplicar', () => {
    const c = componerPorMedio([
      fila({ moneda: 'ARS', monto: d('445500'), cotizacion: d('1485') }),
    ])
    expect(c.ars.total).toBe('445500')
    expect(c.usd.total).toBe('0')
    expect(c.hayDolares).toBe(false)
  })

  it('un pago USD que cubre ARS suma DÓLARES, no su equivalente en pesos', () => {
    const c = componerPorMedio([
      fila({ moneda: 'USD', monto: d('100'), cotizacion: d('1485') }),
    ])
    expect(c.usd.total).toBe('100')
    expect(c.ars.total).toBe('0')
  })

  it('la pila la elige Pago.moneda y el importe es Pago.monto tal cual', () => {
    const c = componerPorMedio([
      fila({ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), _count: 3 }),
      fila({ medio: 'TRANSFERENCIA', moneda: 'USD', monto: d('50'), _count: 2 }),
    ])
    expect(c.ars.total).toBe('3000')
    expect(c.usd.total).toBe('100')
  })

  it('cada pila ordena de mayor a menor por su cuenta', () => {
    const c = componerPorMedio([
      fila({ medio: 'EFECTIVO', monto: d('100') }),
      fila({ medio: 'TRANSFERENCIA', monto: d('900') }),
    ])
    expect(c.ars.barras.map((b) => b.medio)).toEqual(['TRANSFERENCIA', 'EFECTIVO'])
  })

  it('un medio sin un solo pago en esa moneda no aparece en esa pila', () => {
    const c = componerPorMedio([
      fila({ medio: 'EFECTIVO', moneda: 'USD', monto: d('10') }),
    ])
    expect(c.ars.barras).toEqual([])
  })
})
