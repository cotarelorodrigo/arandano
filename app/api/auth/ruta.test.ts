import { describe, it, expect, vi, beforeEach } from 'vitest'

const resolucion = vi.hoisted(() => ({ valor: null as unknown }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => resolucion.valor,
}))
vi.mock('@/lib/auth/origen', () => ({
  origenDelRequest: async () => 'http://flor.arandano.test',
}))

const handler = vi.hoisted(() => vi.fn(async () => new Response('ok', { status: 200 })))
vi.mock('@/lib/auth/para-tenant', () => ({
  authParaTenant: () => ({ handler }),
}))

const { GET, POST } = await import('./[...all]/route')

const pedir = () => new Request('http://flor.arandano.test/api/auth/sign-in/email')

beforeEach(() => handler.mockClear())

describe('el handler de auth', () => {
  it('no existe en el ápex', async () => {
    resolucion.valor = { tipo: 'apex' }
    expect((await GET(pedir())).status).toBe(404)
    expect(handler, 'se llamó a Better Auth sin tenant').not.toHaveBeenCalled()
  })

  it('no existe para un subdominio inexistente', async () => {
    resolucion.valor = { tipo: 'inexistente', subdominio: 'nadie' }
    expect((await POST(pedir())).status).toBe(404)
    expect(handler).not.toHaveBeenCalled()
  })

  it('no existe para un subdominio reservado', async () => {
    resolucion.valor = { tipo: 'reservado', subdominio: 'admin' }
    expect((await GET(pedir())).status).toBe(404)
  })

  it('no existe para un host ajeno', async () => {
    resolucion.valor = { tipo: 'ajeno' }
    expect((await GET(pedir())).status).toBe(404)
  })

  it('delega en Better Auth cuando el tenant resuelve', async () => {
    resolucion.valor = {
      tipo: 'tenant',
      tenant: { id: 'un-uuid', nombre: 'Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    }
    expect((await POST(pedir())).status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('un tenant suspendido no puede entrar', async () => {
    resolucion.valor = {
      tipo: 'tenant',
      tenant: { id: 'un-uuid', nombre: 'Flor', estado: 'SUSPENDIDO' },
      subdominio: 'flor',
    }
    expect((await POST(pedir())).status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })
})
