import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { detalleAutorizado, HEADER_SALUD } from './autorizacion'

describe('detalleAutorizado', () => {
  const original = process.env.ARANDANO_SALUD_TOKEN

  beforeEach(() => {
    process.env.ARANDANO_SALUD_TOKEN = 'un-token-secreto-largo'
  })
  afterEach(() => {
    if (original === undefined) delete process.env.ARANDANO_SALUD_TOKEN
    else process.env.ARANDANO_SALUD_TOKEN = original
  })

  it('autoriza con el token exacto', () => {
    expect(detalleAutorizado('un-token-secreto-largo')).toBe(true)
  })

  it('rechaza un token distinto', () => {
    expect(detalleAutorizado('otro-token-cualquiera')).toBe(false)
  })

  // Sin igualar longitudes: la comparación es sobre digests SHA-256, que
  // siempre miden 32 bytes, así que ni el largo del token se filtra.
  it('rechaza un token de otra longitud sin romperse', () => {
    expect(detalleAutorizado('x')).toBe(false)
    expect(detalleAutorizado('x'.repeat(500))).toBe(false)
  })

  it('rechaza cuando no viene el header', () => {
    expect(detalleAutorizado(null)).toBe(false)
  })

  it('rechaza el string vacío', () => {
    expect(detalleAutorizado('')).toBe(false)
  })

  // Falla cerrado: una configuración incompleta no puede entregar detalle.
  // Es lo que hace que un misconfig se detecte en el deploy en vez de
  // producir un sistema que parece sano.
  it('rechaza si ARANDANO_SALUD_TOKEN no está seteada', () => {
    delete process.env.ARANDANO_SALUD_TOKEN
    expect(detalleAutorizado('un-token-secreto-largo')).toBe(false)
  })

  it('rechaza si ARANDANO_SALUD_TOKEN está vacía', () => {
    process.env.ARANDANO_SALUD_TOKEN = ''
    expect(detalleAutorizado('')).toBe(false)
  })

  it('expone el header en minúscula, que es como llega', () => {
    expect(HEADER_SALUD).toBe('x-arandano-salud')
  })
})
