import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { componerPorMedio, MEDIOS } from './composicion'

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
  it('sin pagos devuelve nada', () => {
    expect(componerPorMedio([])).toEqual({ barras: [], total: '0', hayDolares: false })
  })

  it('convierte los dólares a pesos con la cotización de cada grupo', () => {
    // El mismo medio, dos cotizaciones distintas: es exactamente por eso que el
    // groupBy agrupa TAMBIÉN por cotizacion, y lo que este caso protege.
    const { barras } = componerPorMedio([
      fila('EFECTIVO', 'USD', '100', '1200'),
      fila('EFECTIVO', 'USD', '50', '1300'),
    ])
    expect(barras).toEqual([{ medio: 'EFECTIVO', ars: '0', usd: '185000', usdCrudo: '150', total: '185000' }])
  })

  it('separa pesos de dólares dentro del mismo medio', () => {
    const { barras, hayDolares } = componerPorMedio([
      fila('EFECTIVO', 'ARS', '5000'),
      fila('EFECTIVO', 'USD', '10', '1200'),
    ])
    expect(barras).toEqual([{ medio: 'EFECTIVO', ars: '5000', usd: '12000', usdCrudo: '10', total: '17000' }])
    expect(hayDolares).toBe(true)
  })

  it('ordena de mayor a menor por el total de la barra', () => {
    const { barras } = componerPorMedio([
      fila('TARJETA_DEBITO', 'ARS', '100'),
      fila('EFECTIVO', 'ARS', '900'),
      fila('TRANSFERENCIA', 'ARS', '500'),
    ])
    expect(barras.map((b) => b.medio)).toEqual(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO'])
  })

  it('omite los medios sin pagos en vez de dibujarlos en cero', () => {
    // Una barra de largo cero no dice "no se cobró así": dice "acá falta algo".
    const { barras } = componerPorMedio([fila('EFECTIVO', 'ARS', '900')])
    expect(barras).toHaveLength(1)
  })

  it('el total es la suma de las barras', () => {
    const { total } = componerPorMedio([
      fila('EFECTIVO', 'ARS', '900.55'),
      fila('TARJETA_CREDITO', 'ARS', '100.45'),
    ])
    expect(total).toBe('1001')
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
    // **Los dos pagos van en la MISMA fila**, y ese detalle es el caso. La
    // versión anterior los ponía en medios distintos, o sea en dos grupos de un
    // pago cada uno, donde redondear por pago y redondear por grupo dan lo
    // mismo: el test pasaba en verde sobre una implementación que sumaba
    // primero. Lo levantó la review.
    const { total } = componerPorMedio([fila('EFECTIVO', 'USD', '1', '1450.5555', 2)])
    // Por pago: 1450,56 × 2 = 2901,12. Sobre la suma daría 2901,11.
    expect(total).toBe('2901.12')
  })

  it('cuenta los pagos repetidos de un grupo', () => {
    const { barras } = componerPorMedio([fila('EFECTIVO', 'ARS', '1500', '1', 3)])
    expect(barras[0].total).toBe('4500')
  })

  it('un grupo sin pagos no aporta nada', () => {
    expect(componerPorMedio([fila('EFECTIVO', 'ARS', '1500', '1', 0)]).barras).toEqual([])
  })

  it('un pago en PESOS que cubre el total en dólares no se multiplica dos veces', () => {
    // moneda ARS + cotizacion 1485: `monto` ya está en pesos. Con `montoEnPesos`
    // esto daba 926.194.500.
    const c = componerPorMedio([
      { medio: 'TARJETA_CREDITO', moneda: 'ARS', monto: d('623700'), cotizacion: d('1485'), _count: 1 },
    ])
    expect(c.barras[0].total).toBe('623700')
    expect(c.hayDolares).toBe(false)
  })

  it('los dólares crudos NO pasan por ninguna cotización', () => {
    // El mismo par de filas del caso de arriba: 150 dólares en total, tomados
    // a dos cotizaciones distintas. `usd` los convierte y suma 185.000 pesos;
    // `usdCrudo` dice 150, que es lo que la segunda línea del panel muestra.
    const { barras } = componerPorMedio([
      fila('EFECTIVO', 'USD', '100', '1200'),
      fila('EFECTIVO', 'USD', '50', '1300'),
    ])
    expect(barras[0].usdCrudo).toBe('150')
    expect(barras[0].usd).toBe('185000')
  })

  it('un pago en PESOS con cotización distinta de 1 no aporta a usdCrudo', () => {
    // El pago que cubre el total en dólares entregando pesos (ciclo del
    // 2026-08-29): lleva la cotización real, 1485, con el monto YA en pesos.
    // Entró en pesos, así que la línea de dólares del panel no lo nombra —
    // es la misma regla por la que `pesosEntregados` no lo multiplica.
    const { barras } = componerPorMedio([fila('TARJETA_CREDITO', 'ARS', '623700', '1485')])
    expect(barras[0]).toEqual({
      medio: 'TARJETA_CREDITO',
      ars: '623700',
      usd: '0',
      usdCrudo: '0',
      total: '623700',
    })
  })

  it('multiplica los dólares crudos por la cantidad de pagos del grupo', () => {
    // El `_count` del groupBy: tres pagos idénticos de US$ 20 son US$ 60.
    const { barras } = componerPorMedio([fila('EFECTIVO', 'USD', '20', '1485', 3)])
    expect(barras[0].usdCrudo).toBe('60')
  })
})
