import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import {
  vendidoDeVenta,
  cobradoDePagos,
  cobradoDeGrupos,
  mismosTotales,
  hayQueDesglosar,
  formatearTotales,
  lineasDeImporte,
} from './cobrado'

const d = (v: string) => new Prisma.Decimal(v)
const t = (ars: string, usd: string) => ({ ars: d(ars), usd: d(usd) })

describe('cobradoDePagos', () => {
  // LA regla del ciclo: se apila por la moneda que ENTRÓ (`moneda`), no por
  // el total que el pago cubre (`cubre`). Apilar por `cubre` es exactamente
  // el bug que este ciclo arregla — un pago en pesos que cubre dólares
  // aparecía del lado de los dólares.
  it('un pago en pesos que cubre el total en dólares cuenta como PESOS', () => {
    const c = cobradoDePagos([{ moneda: 'ARS', monto: d('148500') }])
    expect(c.ars.toString()).toBe('148500')
    expect(c.usd.toString()).toBe('0')
  })

  // El caso del feedback: un iPhone de US$ 300 cobrado US$ 200 en billetes
  // más el resto en pesos a 1485.
  it('reparte un cobro partido entre las dos monedas', () => {
    const c = cobradoDePagos([
      { moneda: 'USD', monto: d('200') },
      { moneda: 'ARS', monto: d('148500') },
    ])
    expect(c.ars.toString()).toBe('148500')
    expect(c.usd.toString()).toBe('200')
  })

  it('sin pagos, las dos pilas quedan en cero', () => {
    const c = cobradoDePagos([])
    expect(c.ars.toString()).toBe('0')
    expect(c.usd.toString()).toBe('0')
  })
})

describe('cobradoDeGrupos', () => {
  // Las filas del groupBy traen `_count`: el mismo monto repetido N veces.
  // Se redondea PRIMERO y se multiplica después, igual que componerPorMedio,
  // que es lo que mantiene el redondeo por pago.
  it('multiplica cada grupo por su cantidad', () => {
    const c = cobradoDeGrupos([
      { moneda: 'ARS', monto: d('1000'), _count: 3 },
      { moneda: 'USD', monto: d('50'), _count: 2 },
    ])
    expect(c.ars.toString()).toBe('3000')
    expect(c.usd.toString()).toBe('100')
  })

  it('ignora un grupo con cantidad cero o negativa', () => {
    const c = cobradoDeGrupos([{ moneda: 'ARS', monto: d('1000'), _count: 0 }])
    expect(c.ars.toString()).toBe('0')
  })
})

describe('mismosTotales', () => {
  it('compara las dos monedas, no una', () => {
    expect(mismosTotales(t('100', '0'), t('100', '0'))).toBe(true)
    expect(mismosTotales(t('100', '0'), t('100', '5'))).toBe(false)
    expect(mismosTotales(t('100', '5'), t('101', '5'))).toBe(false)
  })

  it('0 y 0.00 son el mismo número', () => {
    expect(mismosTotales(t('0', '0'), t('0.00', '0.00'))).toBe(true)
  })
})

describe('hayQueDesglosar', () => {
  it('no desglosa cuando las dos magnitudes coinciden y no hubo recargo', () => {
    expect(hayQueDesglosar(t('50000', '0'), t('50000', '0'), d('0'))).toBe(false)
    expect(hayQueDesglosar(t('0', '300'), t('0', '300'), d('0'))).toBe(false)
  })

  it('desglosa cuando difieren', () => {
    expect(hayQueDesglosar(t('0', '300'), t('148500', '200'), d('0'))).toBe(true)
  })

  // La segunda mitad de la regla: con recargo se desglosa SIEMPRE, aunque las
  // dos magnitudes coincidan. En una venta mixta las dos pilas se arman por
  // caminos distintos y nada prueba que un recargo no pueda quedar
  // compensado; un recargo invisible es peor que un desglose de más.
  it('desglosa con recargo aunque las magnitudes coincidan', () => {
    expect(hayQueDesglosar(t('50000', '0'), t('50000', '0'), d('100'))).toBe(true)
    expect(hayQueDesglosar(t('50000', '0'), t('50000', '0'), d('-100'))).toBe(true)
  })
})

describe('formatearTotales', () => {
  it('sólo pesos: un número, sin "+" ni "US$"', () => {
    const texto = formatearTotales(t('103900', '0'))
    expect(texto).toContain('103.900,00')
    expect(texto).not.toContain('US$')
    expect(texto).not.toContain('+')
  })

  // La omisión es nueva y limpia el caso más común: antes de este ciclo la
  // columna mostraba "$ 0,00 + US$ 300,00" para toda venta en dólares.
  it('sólo dólares: se OMITE el lado en cero', () => {
    const texto = formatearTotales(t('0', '300'))
    expect(texto).toContain('US$')
    expect(texto).toContain('300,00')
    expect(texto).not.toContain('+')
  })

  it('las dos monedas: pesos primero, unidas por "+"', () => {
    const texto = formatearTotales(t('148500', '200'))
    const posArs = texto.indexOf('148.500,00')
    const posUsd = texto.indexOf('US$')
    expect(posArs).toBeGreaterThan(-1)
    expect(posUsd).toBeGreaterThan(posArs)
    expect(texto).toContain('+')
  })

  it('las dos en cero: "$ 0,00", nunca un string vacío', () => {
    expect(formatearTotales(t('0', '0'))).toContain('0,00')
  })
})

describe('lineasDeImporte', () => {
  it('una sola línea SIN rótulo cuando no hay nada que desglosar', () => {
    const lineas = lineasDeImporte(t('50000', '0'), t('50000', '0'), d('0'))
    expect(lineas).toHaveLength(1)
    expect(lineas[0].rotulo).toBeUndefined()
    expect(lineas[0].valor).toContain('50.000,00')
  })

  it('dos líneas rotuladas Vendido/Cobrado, en ese orden', () => {
    const lineas = lineasDeImporte(t('0', '300'), t('148500', '200'), d('0'))
    expect(lineas).toHaveLength(2)
    expect(lineas[0].rotulo).toBe('Vendido')
    expect(lineas[0].valor).toContain('300,00')
    expect(lineas[1].rotulo).toBe('Cobrado')
    expect(lineas[1].valor).toContain('148.500,00')
  })
})

describe('vendidoDeVenta', () => {
  it('la mercadería a precio de lista, partida por moneda', () => {
    const v = vendidoDeVenta({ total: d('50000'), totalUsd: d('300') })
    expect(v.ars.toString()).toBe('50000')
    expect(v.usd.toString()).toBe('300')
  })
})

// El invariante que sostiene la decisión de "sólo cuando difieren": sin
// dólares de por medio, lo cobrado es EXACTAMENTE `total + recargo`, así que
// un local que vende en pesos sin planes cae siempre a una sola línea y no ve
// ninguna diferencia respecto de antes de este ciclo. Sale de que el motor
// garantiza `Σ base = total` y de que `monto = base + recargo` por pago.
describe('el invariante de un local sin dólares', () => {
  it('Σ Pago.monto es total + recargo, así que nunca se desglosa sin recargo', () => {
    const total = d('50000')
    const recargo = d('0')
    const cobrado = cobradoDePagos([
      { moneda: 'ARS', monto: d('30000') },
      { moneda: 'ARS', monto: d('20000') },
    ])
    expect(cobrado.ars.toString()).toBe(total.add(recargo).toString())
    expect(hayQueDesglosar(vendidoDeVenta({ total, totalUsd: d('0') }), cobrado, recargo)).toBe(false)
  })

  it('con plan, cobrado supera a vendido y por eso se desglosa', () => {
    const total = d('50000')
    const recargo = d('20000')
    const cobrado = cobradoDePagos([{ moneda: 'ARS', monto: d('70000') }])
    expect(cobrado.ars.toString()).toBe(total.add(recargo).toString())
    expect(hayQueDesglosar(vendidoDeVenta({ total, totalUsd: d('0') }), cobrado, recargo)).toBe(true)
  })
})
