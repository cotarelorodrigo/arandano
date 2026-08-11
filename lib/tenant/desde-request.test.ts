import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getHeader = vi.fn()
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (n: string) => getHeader(n) }),
}))

const resolverTenant = vi.fn()
vi.mock('@/lib/tenant/resolver', () => ({
  resolverTenant: (s: string) => resolverTenant(s),
}))

async function correr() {
  const { tenantDelRequest } = await import('@/lib/tenant/desde-request')
  return tenantDelRequest()
}

describe('tenantDelRequest', () => {
  const original = process.env.DOMINIO_BASE

  beforeEach(() => {
    vi.resetModules()
    getHeader.mockReset()
    resolverTenant.mockReset()
    process.env.DOMINIO_BASE = 'arandano.app'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.DOMINIO_BASE
    else process.env.DOMINIO_BASE = original
  })

  it('resuelve un tenant existente', async () => {
    getHeader.mockReturnValue('flor.arandano.app')
    resolverTenant.mockResolvedValue({ id: 'abc', nombre: 'Flor', estado: 'ACTIVO' })

    expect(await correr()).toEqual({
      tipo: 'tenant',
      tenant: { id: 'abc', nombre: 'Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    expect(resolverTenant).toHaveBeenCalledWith('flor')
  })

  it('reporta apex sin consultar la base', async () => {
    getHeader.mockReturnValue('arandano.app')
    expect(await correr()).toEqual({ tipo: 'apex' })
    expect(resolverTenant).not.toHaveBeenCalled()
  })

  it('reporta ajeno para un dominio que no es nuestro', async () => {
    getHeader.mockReturnValue('ejemplo.com')
    expect(await correr()).toEqual({ tipo: 'ajeno' })
    expect(resolverTenant).not.toHaveBeenCalled()
  })

  // Un reservado no llega nunca a la base: si alguien crea a mano una fila con
  // subdominio 'admin', igual no resuelve.
  it('corta los reservados antes de consultar', async () => {
    getHeader.mockReturnValue('admin.arandano.app')
    expect(await correr()).toEqual({ tipo: 'reservado', subdominio: 'admin' })
    expect(resolverTenant).not.toHaveBeenCalled()
  })

  it('distingue inexistente de ajeno', async () => {
    getHeader.mockReturnValue('nadie.arandano.app')
    resolverTenant.mockResolvedValue(null)
    expect(await correr()).toEqual({ tipo: 'inexistente', subdominio: 'nadie' })
  })

  // EL CASO QUE MOTIVÓ QUE ESTA FUNCIÓN MIRE `x-forwarded-host`.
  //
  // Cuando un server action redirige, Next NO renderiza el destino en el mismo
  // request: hace un `fetch()` HTTP contra sí mismo
  // (`createRedirectRenderResult`, node_modules/next/dist/server/app-render/
  // action-handler.js) hacia el origen con el que arrancó el servidor, y
  // devuelve ese render incrustado en la respuesta del action. Como es un
  // fetch de verdad, el `Host` que llega a ese render es el del destino
  // —`localhost:3000`—, y el hostname que pidió el navegador sobrevive
  // ÚNICAMENTE en `x-forwarded-host`.
  //
  // Leyendo sólo `host`, ese render resolvía 'ajeno' y `app/page.tsx` contestaba
  // notFound(): entrar al login dejaba la URL en `/` mostrando el 404 de Next, y
  // un F5 —un GET normal, con el Host bueno— lo arreglaba.
  it('prefiere x-forwarded-host, que es lo único que sobrevive al fetch interno de un redirect de server action', async () => {
    getHeader.mockImplementation((n: string) =>
      n === 'x-forwarded-host' ? 'flor.arandano.app' : 'localhost:3000',
    )
    resolverTenant.mockResolvedValue({ id: 'abc', nombre: 'Flor', estado: 'ACTIVO' })

    expect(await correr()).toEqual({
      tipo: 'tenant',
      tenant: { id: 'abc', nombre: 'Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
  })

  // No es un fallback teórico: Next completa `x-forwarded-host` con el `host`
  // en CADA request que entra (base-server.js), así que en la práctica siempre
  // está. El fallback existe para no depender de ese detalle interno.
  it('usa host cuando no hay x-forwarded-host', async () => {
    getHeader.mockImplementation((n: string) =>
      n === 'x-forwarded-host' ? null : 'flor.arandano.app',
    )
    resolverTenant.mockResolvedValue({ id: 'abc', nombre: 'Flor', estado: 'ACTIVO' })

    expect(await correr()).toMatchObject({ tipo: 'tenant', subdominio: 'flor' })
  })

  // Sin DOMINIO_BASE no se puede decidir nada, y adivinar sería peor: un
  // default silencioso haría que cualquier host resolviera en algún entorno.
  it('falla ruidosamente si falta DOMINIO_BASE', async () => {
    delete process.env.DOMINIO_BASE
    getHeader.mockReturnValue('flor.arandano.app')
    await expect(correr()).rejects.toThrow(/DOMINIO_BASE/)
  })
})
