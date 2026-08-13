import { describe, it, expect } from 'vitest'
import { MAXIMO_POR_VENTANA, claveDeEnvio, envioBloqueado, registrarEnvio } from './limite'

const HORA = 60 * 60 * 1000

describe('límite de envíos de la landing', () => {
  it('la clave sale de la IP del request', () => {
    const cabeceras = new Headers({ 'x-forwarded-for': '200.1.2.3' })
    expect(claveDeEnvio(cabeceras)).toContain('200.1.2.3')
  })

  // Sin IP confiable todos comparten bucket. El modo de falla es un formulario
  // más restrictivo, nunca uno más abierto.
  it('sin IP, la clave es la misma para todos', () => {
    expect(claveDeEnvio(new Headers())).toBe(claveDeEnvio(new Headers()))
  })

  it('deja pasar hasta el máximo y corta el siguiente', () => {
    const clave = 'ip-que-envia-mucho'
    const ahora = 1_000_000
    for (let i = 0; i < MAXIMO_POR_VENTANA; i++) {
      expect(envioBloqueado(clave, ahora)).toBe(false)
      registrarEnvio(clave, ahora)
    }
    expect(envioBloqueado(clave, ahora)).toBe(true)
  })

  it('la ventana vence y vuelve a dejar pasar', () => {
    const clave = 'ip-que-espera'
    const ahora = 2_000_000
    for (let i = 0; i < MAXIMO_POR_VENTANA; i++) registrarEnvio(clave, ahora)
    expect(envioBloqueado(clave, ahora)).toBe(true)
    expect(envioBloqueado(clave, ahora + HORA + 1)).toBe(false)
  })

  it('una IP no le gasta los envíos a otra', () => {
    const ahora = 3_000_000
    for (let i = 0; i < MAXIMO_POR_VENTANA; i++) registrarEnvio('ip-a', ahora)
    expect(envioBloqueado('ip-a', ahora)).toBe(true)
    expect(envioBloqueado('ip-b', ahora)).toBe(false)
  })
})
