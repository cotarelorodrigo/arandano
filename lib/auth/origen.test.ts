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
  const originalDominio = process.env.DOMINIO_BASE
  const originalPuerto = process.env.PUERTO_PUBLICO

  beforeEach(() => {
    vi.resetModules()
    getHeader.mockReset()
    process.env.DOMINIO_BASE = 'arandano.app'
    delete process.env.PUERTO_PUBLICO
  })

  afterEach(() => {
    if (originalDominio === undefined) delete process.env.DOMINIO_BASE
    else process.env.DOMINIO_BASE = originalDominio
    if (originalPuerto === undefined) delete process.env.PUERTO_PUBLICO
    else process.env.PUERTO_PUBLICO = originalPuerto
  })

  it('arma el origen desde el subdominio y DOMINIO_BASE, con http de fallback', async () => {
    getHeader.mockReturnValue(null)
    expect(await correr('flor')).toBe('http://flor.arandano.app')
  })

  it('usa x-forwarded-proto cuando Caddy lo manda', async () => {
    getHeader.mockImplementation((n: string) => (n === 'x-forwarded-proto' ? 'https' : null))
    expect(await correr('flor')).toBe('https://flor.arandano.app')
  })

  it('acepta http explícito por la lista blanca', async () => {
    getHeader.mockImplementation((n: string) => (n === 'x-forwarded-proto' ? 'http' : null))
    expect(await correr('flor')).toBe('http://flor.arandano.app')
  })

  it('sin el header, cae a http', async () => {
    getHeader.mockReturnValue(null)
    expect(await correr('flor')).toBe('http://flor.arandano.app')
  })

  // El caso que prueba el arreglo: quien alcanza la app sin pasar por Caddy
  // (en dev, directo por la IP de Tailscale) puede mandar cualquier valor en
  // x-forwarded-proto. Sin lista blanca, cada valor inventado arma un origen
  // distinto y una clave de caché nueva en authParaTenant — el mismo ataque
  // que el puerto, mudado al protocolo.
  it('un protocolo inventado cae a http, no se cuela', async () => {
    getHeader.mockImplementation((n: string) => (n === 'x-forwarded-proto' ? 'loquesea' : null))
    expect(await correr('flor')).toBe('http://flor.arandano.app')
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

  // El puerto es dato de la configuración del stack, no del request — leerlo
  // del Host reabriría el mismo ataque que el test de arriba documenta.
  it('con PUERTO_PUBLICO definida, el origen lo incluye', async () => {
    process.env.PUERTO_PUBLICO = '3000'
    expect(await correr('flor')).toBe('http://flor.arandano.app:3000')
  })

  // El caso que protege producción: si alguien le pusiera un default a esta
  // variable, el baseURL de producción (donde PUERTO_PUBLICO no está definida,
  // porque 443 va implícito en https://) se rompería en silencio.
  it('sin PUERTO_PUBLICO, el origen no lleva ningún puerto', async () => {
    expect(await correr('flor')).not.toContain(':3000')
    expect(await correr('flor')).not.toMatch(/arandano\.app:\d/)
  })
})
