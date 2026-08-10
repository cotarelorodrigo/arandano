import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getHeader = vi.fn()
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (n: string) => getHeader(n) }),
}))

async function correr(subdominio: string) {
  const { origenDelRequest } = await import('@/lib/auth/origen')
  return origenDelRequest(subdominio)
}

describe('origenDelRequest', () => {
  const original = process.env.DOMINIO_BASE

  beforeEach(() => {
    vi.resetModules()
    getHeader.mockReset()
    process.env.DOMINIO_BASE = 'arandano.app'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.DOMINIO_BASE
    else process.env.DOMINIO_BASE = original
  })

  it('arma el origen desde el subdominio y DOMINIO_BASE, con http de fallback', async () => {
    getHeader.mockReturnValue(null)
    expect(await correr('flor')).toBe('http://flor.arandano.app')
  })

  it('usa x-forwarded-proto cuando Caddy lo manda', async () => {
    getHeader.mockImplementation((n: string) => (n === 'x-forwarded-proto' ? 'https' : null))
    expect(await correr('flor')).toBe('https://flor.arandano.app')
  })

  // El punto entero del cambio obligatorio: el Host crudo puede traer un
  // puerto arbitrario (`flor.arandano.app:9999`) que igual resuelve al mismo
  // tenant (subdominioDeHost lo descarta), pero infla la clave de caché de
  // authParaTenant y permite desalojar instancias de OTROS tenants —
  // reiniciando su rate limit de login. Por eso esta función ni siquiera lee
  // el header Host: no hay puerto que colar porque no hay Host que leer.
  it('nunca lee el header Host', async () => {
    await correr('flor')
    expect(getHeader).not.toHaveBeenCalledWith('host')
  })

  it('falla ruidosamente si falta DOMINIO_BASE', async () => {
    delete process.env.DOMINIO_BASE
    await expect(correr('flor')).rejects.toThrow(/DOMINIO_BASE/)
  })
})
