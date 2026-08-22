import { describe, it, expect } from 'vitest'
import {
  formatearPrecio, formatearDolares, formatearCantidad, formatearFecha, formatearHora,
  montoSinSigno,
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
