import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import {
  aCentavos, aMilesimas, aDiezMilesimas, deCentavos, deMilesimas,
  cantidadEnMilesimas, dineroEnCentavos, cotizacionEnDiezMilesimas,
  subtotalEnCentavos, totalEnCentavos,
  pesosDePagoEnCentavos, totalDePagosEnCentavos,
  recargoEnCentavos, porcentajeEnMilesimas,
  aporteEnCentavos, montoEntregadoEnCentavos, totalesEnCentavos,
} from './centavos'
import { totalDeItems, totalDePagos, recargoDePago, aporteDePago, montoEntregado } from './totales'
import { aDecimal, ErrorDeFormato } from '@/lib/formato/numeros'

describe('conversión a enteros', () => {
  it('lee el toString de un Decimal de plata', () => {
    expect(aCentavos('1500.5')).toBe(150050)
    expect(aCentavos('1500')).toBe(150000)
    expect(aCentavos('0.05')).toBe(5)
    expect(aCentavos('0')).toBe(0)
  })

  it('lee el toString de un Decimal de cantidad', () => {
    expect(aMilesimas('2')).toBe(2000)
    expect(aMilesimas('0.5')).toBe(500)
    expect(aMilesimas('1.125')).toBe(1125)
  })

  // La cotización tiene CUATRO decimales, no tres: convertirla con aMilesimas
  // truncaría el último y desalinearía el total del botón respecto del servidor.
  it('lee el toString de una cotización, con sus cuatro decimales', () => {
    expect(aDiezMilesimas('1')).toBe(10000)
    expect(aDiezMilesimas('1234.5678')).toBe(12345678)
    expect(aDiezMilesimas('0.0001')).toBe(1)
  })

  it('vuelve a texto con dos decimales, que es como se guarda', () => {
    expect(deCentavos(150050)).toBe('1500.50')
    expect(deCentavos(5)).toBe('0.05')
    expect(deCentavos(0)).toBe('0.00')
  })

  // SIN ceros de relleno a la derecha, y eso no es cosmética: lo que devuelve
  // esta función se escribe en el campo de cantidad y viaja al servidor, que
  // rechaza `2.000` por ambiguo. El describe de más abajo es el que lo ata.
  it('vuelve a texto sin ceros de relleno a la derecha', () => {
    expect(deMilesimas(1000)).toBe('1')
    expect(deMilesimas(2000)).toBe('2')
    expect(deMilesimas(1118)).toBe('1.118')
    expect(deMilesimas(1500)).toBe('1.5')
    expect(deMilesimas(500)).toBe('0.5')
    expect(deMilesimas(0)).toBe('0')
  })
})

describe('subtotal', () => {
  it('multiplica y redondea a centavos', () => {
    // 3 × 1500,50 = 4501,50
    expect(subtotalEnCentavos(3000, 150050)).toBe(450150)
  })

  it('redondea medio centavo para arriba, como el servidor', () => {
    // 0,5 × 0,05 = 0,025 -> 0,03 con ROUND_HALF_UP
    expect(subtotalEnCentavos(500, 5)).toBe(3)
  })
})

describe('pagos', () => {
  it('un pago en pesos vale su monto', () => {
    expect(pesosDePagoEnCentavos(150050, 10000)).toBe(150050)
  })

  it('un pago en dólares vale monto × cotización', () => {
    // US$ 0,80 a 1250 = $1000
    expect(pesosDePagoEnCentavos(80, 12500000)).toBe(100000)
  })

  it('no pierde el cuarto decimal de la cotización', () => {
    // US$ 100 a 1234,5678 = $123456,78
    expect(pesosDePagoEnCentavos(10000, 12345678)).toBe(12345678)
  })
})

// El test que justifica el archivo: si estas dos aritméticas se separan, el
// botón se habilita para una venta que el motor rechaza.
describe('coincide con la del servidor', () => {
  const casos = [
    [['3', '1500.50'], ['1', '0.05']],
    [['0.5', '0.05'], ['0.333', '99.99']],
    [['2.125', '1234.56']],
    [['1', '0.01'], ['1', '0.01'], ['1', '0.01']],
  ]

  it.each(casos)('da el mismo total que totalDeItems: %j', (...lineas) => {
    const delServidor = totalDeItems(
      lineas.map(([c, p]) => ({
        cantidad: new Prisma.Decimal(c),
        precioUnitario: new Prisma.Decimal(p),
      })),
    )
    const delCliente = totalEnCentavos(
      lineas.map(([c, p]) => ({ cantidadMilesimas: aMilesimas(c), precioCentavos: aCentavos(p) })),
    )
    expect(deCentavos(delCliente)).toBe(delServidor.toFixed(2))
  })

  const casosDePago: [string, string][][] = [
    [['1000', '1']],
    [['0.8', '1250']],
    [['100', '1234.5678']],
    [['500', '1'], ['0.4', '1250']],
  ]

  it.each(casosDePago)('da el mismo total que totalDePagos: %j', (...pagos) => {
    const delServidor = totalDePagos(
      pagos.map(([m, c]) => ({
        monto: new Prisma.Decimal(m),
        cotizacion: new Prisma.Decimal(c),
      })),
    )
    const delCliente = totalDePagosEnCentavos(
      pagos.map(([m, c]) => ({ montoCentavos: aCentavos(m), cotizacionDiezMilesimas: aDiezMilesimas(c) })),
    )
    expect(deCentavos(delCliente)).toBe(delServidor.toFixed(2))
  })
})

/**
 * El seam que faltaba.
 *
 * El describe de arriba ata esta aritmética a `totales.ts`, que es OTRO módulo
 * del servidor: el que decide si los pagos cierran. Nada ataba la pantalla a
 * `numeros.ts`, que es quien parsea de verdad lo que el formulario manda — y
 * por esa juntura se colaron los dos bugs de esta tanda: `agregar` escribía
 * `"2.000"` en el campo de cantidad, que `aDecimal` rechaza por ambiguo (la
 * venta entera se volvía incobrable después de pasar dos veces el lector), y
 * las conversiones del cliente leían `1.500,50` como uno con cincuenta cuando
 * el servidor lo lee como mil quinientos.
 *
 * La regla que estos tests fijan: **todo texto que la pantalla escribe en un
 * campo tiene que ser texto que `aDecimal` acepta**, y todo texto tipeado tiene
 * que valer lo mismo de los dos lados —o ser rechazado por los dos.
 */
describe('lo que la pantalla escribe en un campo, el servidor lo acepta', () => {
  // Pasar el lector N veces por el mismo código: el gesto más común de un
  // mostrador, y el que estaba roto. Se simula el ciclo COMPLETO —leer el
  // campo, sumar mil milésimas, volver a escribirlo— porque el bug vivía en el
  // ida y vuelta, no en ninguna de las dos puntas por separado.
  it.each([1, 2, 3, 4, 5, 10, 11, 100])('sumar hasta %i unidades deja el campo cobrable', (veces) => {
    let campo = '1'
    for (let i = 1; i < veces; i++) {
      campo = deMilesimas(cantidadEnMilesimas(campo) + 1000)
    }
    // El servidor lo acepta...
    expect(aDecimal(campo, 'la cantidad').toString()).toBe(String(veces))
    // ...y vale lo mismo que lo que la pantalla venía contando.
    expect(cantidadEnMilesimas(campo)).toBe(veces * 1000)
  })

  it('y también arrancando de una fracción', () => {
    // Medio kilo y después una unidad más: 1,5 tiene que seguir siendo legible.
    const campo = deMilesimas(cantidadEnMilesimas('0,5') + 1000)
    expect(campo).toBe('1.5')
    expect(aDecimal(campo, 'la cantidad').toString()).toBe('1.5')
  })

  // El monto de un pago también se escribe solo: el ajuste que sigue al total
  // pone ahí `deCentavos(...)`, así que esa forma tiene que volver a entrar.
  it.each([0, 5, 150050, 85000000])('un monto autocompletado de %i centavos vuelve a entrar', (centavos) => {
    const campo = deCentavos(centavos)
    expect(dineroEnCentavos(campo)).toBe(centavos)
    expect(aCentavos(aDecimal(campo, 'el monto').toString())).toBe(centavos)
  })
})

describe('lo que la persona tipea vale lo mismo de los dos lados', () => {
  // Las dos primeras son las que la pantalla MUESTRA (`formatearPrecio` emite
  // punto de miles y coma decimal), así que son las que alguien retipea.
  const montos: [string, number][] = [
    ['1.500,50', 150050],
    ['1500,50', 150050],
    ['1500.50', 150050],
    ['1500', 150000],
    ['0,05', 5],
    ['1.500.000', 150000000],
  ]
  it.each(montos)('%s son %i centavos', (texto, centavos) => {
    expect(dineroEnCentavos(texto)).toBe(centavos)
    expect(aCentavos(aDecimal(texto, 'el monto').toString())).toBe(centavos)
  })

  const cantidades: [string, number][] = [
    ['2', 2000],
    ['0,5', 500],
    ['0.5', 500],
    ['0,125', 125],
    ['1234,567', 1234567],
  ]
  it.each(cantidades)('%s son %i milésimas', (texto, milesimas) => {
    expect(cantidadEnMilesimas(texto)).toBe(milesimas)
    expect(aMilesimas(aDecimal(texto, 'la cantidad').toString())).toBe(milesimas)
  })

  const cotizaciones: [string, number][] = [
    ['1', 10000],
    ['1234,5678', 12345678],
    ['1.234,5678', 12345678],
  ]
  it.each(cotizaciones)('%s son %i diezmilésimas', (texto, diezmilesimas) => {
    expect(cotizacionEnDiezMilesimas(texto)).toBe(diezmilesimas)
    expect(aDiezMilesimas(aDecimal(texto, 'la cotización').toString())).toBe(diezmilesimas)
  })

  // La otra mitad, y la que dejaba habilitar Cobrar para una venta perdida: lo
  // que el servidor rechaza no puede valer un número en la pantalla. El campo
  // VACÍO está en la lista a propósito — contaba como cero.
  const rechazados = ['', '   ', '850.000', '1.500', '12,345', 'abc', '-5', '1,5,5', '1..5']
  it.each(rechazados)('ninguno de los dos lados acepta %j', (texto) => {
    expect(() => aDecimal(texto, 'la cantidad')).toThrowError(ErrorDeFormato)
    expect(cantidadEnMilesimas(texto)).toBeNaN()
    expect(dineroEnCentavos(texto)).toBeNaN()
    expect(cotizacionEnDiezMilesimas(texto)).toBeNaN()
  })
})

describe('el recargo del navegador espeja al del servidor', () => {
  const CASOS: { base: string; porcentaje: string }[] = [
    { base: '100000', porcentaje: '25' },
    { base: '10000', porcentaje: '-10' },
    { base: '9999.99', porcentaje: '0' },
    { base: '1', porcentaje: '50' },
    { base: '1', porcentaje: '-50' },
    { base: '10000', porcentaje: '13.75' },
    { base: '333.33', porcentaje: '40' },
    { base: '0.01', porcentaje: '999.999' },
    // El caso que de verdad separa Math.round() del ROUND_HALF_UP de Decimal:
    // 1 al 0,5 % = 0,005 exacto, la mitad exacta de un centavo. Para el
    // negativo, Math.round(-0.5) da -0 (redondea hacia +∞) y el servidor da
    // -0,01 (se aleja del cero). Los pares "redondos" de arriba (50 %, -50 %)
    // NO son mitades — 1 × 50 / 100 = 0,5, ya exacto a dos decimales — así
    // que no simplificar este par de vuelta a uno "más prolijo".
    { base: '1', porcentaje: '0.5' },
    { base: '1', porcentaje: '-0.5' },
  ]

  for (const c of CASOS) {
    it(`base ${c.base} al ${c.porcentaje} %`, () => {
      const servidor = recargoDePago(new Prisma.Decimal(c.base), new Prisma.Decimal(c.porcentaje))
      const navegador = recargoEnCentavos(aCentavos(c.base), porcentajeEnMilesimas(c.porcentaje))
      expect(navegador, `${c.base} al ${c.porcentaje} %`).toBe(aCentavos(servidor.toString()))
    })
  }

  it('un porcentaje que no se entiende da NaN, no cero', () => {
    expect(porcentajeEnMilesimas('')).toBeNaN()
    expect(porcentajeEnMilesimas('cuarenta')).toBeNaN()
  })
})

// El caso que separa las dos aritméticas si alguna redondea en un momento
// distinto del otro: base chica, cotización con sus cuatro decimales.
describe('aporteEnCentavos espeja a aporteDePago', () => {
  const casos = [
    { moneda: 'ARS', cubre: 'ARS', base: '15000', cotizacion: '1' },
    { moneda: 'USD', cubre: 'ARS', base: '300', cotizacion: '1485' },
    { moneda: 'USD', cubre: 'USD', base: '300', cotizacion: '1' },
    { moneda: 'ARS', cubre: 'USD', base: '300', cotizacion: '1485' },
    { moneda: 'USD', cubre: 'ARS', base: '0.05', cotizacion: '1485.3333' },
  ] as const

  it.each(casos)('mismo aporte y mismo monto entregado: %j', (c) => {
    const delServidor = aporteDePago({
      moneda: c.moneda, cubre: c.cubre,
      base: new Prisma.Decimal(c.base), cotizacion: new Prisma.Decimal(c.cotizacion),
    })
    const delCliente = aporteEnCentavos({
      moneda: c.moneda, cubre: c.cubre,
      baseCentavos: aCentavos(c.base),
      cotizacionDiezMilesimas: aDiezMilesimas(c.cotizacion),
    })
    expect(delCliente).toBe(aCentavos(delServidor.toString()))

    const entregadoServidor = montoEntregado({
      moneda: c.moneda, cubre: c.cubre,
      base: new Prisma.Decimal(c.base), cotizacion: new Prisma.Decimal(c.cotizacion),
    })
    const entregadoCliente = montoEntregadoEnCentavos({
      moneda: c.moneda, cubre: c.cubre,
      baseCentavos: aCentavos(c.base),
      cotizacionDiezMilesimas: aDiezMilesimas(c.cotizacion),
    })
    expect(entregadoCliente).toBe(aCentavos(entregadoServidor.toString()))
  })
})

describe('totalesEnCentavos', () => {
  it('parte el carrito por moneda', () => {
    const t = totalesEnCentavos([
      { cantidadMilesimas: 2000, precioCentavos: 750000, moneda: 'ARS' },
      { cantidadMilesimas: 1000, precioCentavos: 30000, moneda: 'USD' },
    ])
    expect(t.ars).toBe(1500000)
    expect(t.usd).toBe(30000)
  })

  it('una cantidad en NaN envenena SÓLO su moneda', () => {
    const t = totalesEnCentavos([
      { cantidadMilesimas: NaN, precioCentavos: 750000, moneda: 'ARS' },
      { cantidadMilesimas: 1000, precioCentavos: 30000, moneda: 'USD' },
    ])
    expect(Number.isNaN(t.ars)).toBe(true)
    expect(t.usd).toBe(30000)
  })
})
