import { describe, it, expect } from 'vitest'
import {
  formatearPrecio, formatearDolares, formatearCantidad, formatearFecha, formatearHora,
  formatearFechaCorta, montoSinSigno, formatearPorcentaje,
} from './mostrar'

// Puro: sin Docker, sin base. `Intl` alcanza y corre en cualquier Node.

describe('formatearPrecio', () => {
  it('renderiza como moneda argentina', () => {
    const salida = formatearPrecio('1500.5')
    // No se assertea el string exacto: el símbolo, el separador de miles y el
    // espacio entre ellos son cosa de ICU y pueden variar entre versiones de
    // Node sin que el formateador esté roto. Lo que importa es que se lea
    // como pesos y que el número esté entero.
    expect(salida).toMatch(/\$/)
    expect(salida).toContain('1.500,50')
  })
})

describe('formatearDolares', () => {
  // El detalle de venta anteponía "US$ " a mano a un formateador que ya emite
  // el `$` de pesos, y salía "US$ $ 0,80". Un solo símbolo, y de dólares.
  it('lleva un solo símbolo, y es el de dólares', () => {
    const salida = formatearDolares('0.8')
    expect(salida).toContain('0,80')
    expect(salida).toMatch(/US\$/)
    expect(salida).not.toMatch(/\$.*\$/)
  })
})

describe('formatearCantidad', () => {
  it('una cantidad entera no lleva decimales de relleno', () => {
    expect(formatearCantidad('4')).toBe('4')
  })

  it('una cantidad con fracción conserva los decimales', () => {
    const salida = formatearCantidad('0.5')
    expect(salida).toContain('0')
    expect(salida).toContain('5')
    expect(salida).not.toBe('0')
  })
})

describe('formatearFecha', () => {
  // El caso load-bearing: sin `timeZone: 'America/Argentina/Buenos_Aires'` en
  // `mostrar.ts`, este mismo instante se lee con el huso del servidor
  // (Ashburn, UTC-4/-5) y el test falla — que es exactamente el punto: si
  // alguien borra esa línea porque "total, en dev nadie lo nota", este test
  // es el que lo agarra.
  it('usa el día de Buenos Aires, no el de UTC', () => {
    // 2026-03-15T01:30:00Z son las 22:30 del 14 de marzo en Buenos Aires
    // (UTC-3): mismo instante, día distinto según el huso.
    const instante = new Date('2026-03-15T01:30:00Z')
    const salida = formatearFecha(instante)
    expect(salida).toContain('14')
    expect(salida).not.toContain('15')
  })
})

describe('formatearHora', () => {
  // Mismo caso load-bearing que formatearFecha, y por el mismo motivo: sin el
  // huso, la columna "Hora" del listado de /ventas mostraría la de Ashburn.
  it('usa la hora de Buenos Aires, no la de UTC', () => {
    const instante = new Date('2026-03-15T01:30:00Z') // 22:30 del 14/03 en AR
    const salida = formatearHora(instante)
    expect(salida).toContain('22:30')
  })

  it('no lleva la fecha, sólo la hora', () => {
    const salida = formatearHora(new Date('2026-03-15T17:30:00Z'))
    expect(salida).not.toContain('2026')
    // Sin separador de fecha: si "short" alguna vez se coló acá en vez de
    // "timeStyle", esto es lo que lo delata sin depender de qué dígitos
    // coincidan por casualidad entre la hora y el día.
    expect(salida).not.toMatch(/\//)
  })
})

describe('formatearFechaCorta', () => {
  it('día, mes y año, con los cuatro dígitos del año', () => {
    const instante = new Date('2026-08-21T20:28:00Z') // 17:28 en Buenos Aires
    expect(formatearFechaCorta(instante)).toBe('21/08/2026')
  })

  it('usa el día de Buenos Aires, no el de UTC', () => {
    const instante = new Date('2026-03-15T01:30:00Z') // 22:30 del 14/03 en AR
    expect(formatearFechaCorta(instante)).toBe('14/03/2026')
  })
})

// Extraída de la review final del rediseño de /vender: el mismo
// `.replace(/^\D+/, '')` estaba escrito dos veces (la banda del total de
// punto-de-venta.tsx y el chip de cotización de caja.tsx) para separar el
// signo de moneda de un valor ya formateado.
describe('montoSinSigno', () => {
  it('descarta el signo de pesos', () => {
    expect(montoSinSigno(formatearPrecio('1500.5'))).toBe('1.500,50')
  })

  it('descarta el signo de dólares, de dos caracteres', () => {
    expect(montoSinSigno(formatearDolares('0.8'))).toBe('0,80')
  })

  it('no toca un valor que ya viene sin signo', () => {
    expect(montoSinSigno('1.500,50')).toBe('1.500,50')
  })
})

describe('formatearPorcentaje', () => {
  // El signo es la mitad del dato: un `40 %` pelado al lado de un `−10 %` deja
  // la tabla de planes sin decir cuál recarga y cuál descuenta.
  it('un recargo lleva el signo adelante', () => {
    expect(formatearPorcentaje('40')).toMatch(/^\+40/)
  })

  it('un descuento por pago contado se lee como negativo', () => {
    const salida = formatearPorcentaje('-10')
    expect(salida).toContain('10')
    // El signo lo pone ICU; puede ser `-` o `−` según la versión de Node.
    expect(salida).not.toMatch(/^\+/)
    expect(salida.charCodeAt(0)).not.toBe('4'.charCodeAt(0))
  })

  // Cero no es ni recargo ni descuento, así que no lleva signo.
  it('un plan sin recargo no lleva signo', () => {
    expect(formatearPorcentaje('0')).not.toMatch(/[+]/)
  })

  // La escala de Decimal(6,3): los costos financieros reales vienen así, y
  // dividir por 100 para el estilo `percent` no puede perderlos.
  it('conserva los tres decimales que la columna guarda', () => {
    expect(formatearPorcentaje('13.755')).toContain('13,755')
    expect(formatearPorcentaje('999.999')).toContain('999,999')
  })

  // Sin ceros de relleno: un `40,000 %` sería ruido en una celda que se escanea.
  it('un entero no lleva decimales de relleno', () => {
    expect(formatearPorcentaje('40')).not.toContain(',')
  })
})
