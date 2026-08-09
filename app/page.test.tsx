import { describe, it, expect, vi, beforeEach } from 'vitest'

const tenantDelRequest = vi.fn()
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: () => tenantDelRequest(),
}))

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
const forbidden = vi.fn(() => {
  throw new Error('NEXT_FORBIDDEN')
})
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  forbidden: () => forbidden(),
}))

async function render() {
  const { default: Home } = await import('@/app/page')
  return Home()
}

describe('página raíz', () => {
  beforeEach(() => {
    vi.resetModules()
    tenantDelRequest.mockReset()
    notFound.mockClear()
    forbidden.mockClear()
  })

  it('404 para un dominio ajeno', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'ajeno' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('404 para un subdominio reservado', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'reservado', subdominio: 'admin' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('404 para un subdominio inexistente', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'inexistente', subdominio: 'nadie' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  // 403 y no 404, deliberadamente: son mensajes distintos para situaciones
  // distintas.
  it('403 para un tenant suspendido', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'SUSPENDIDO' },
    })
    await expect(render()).rejects.toThrow('NEXT_FORBIDDEN')
    expect(notFound).not.toHaveBeenCalled()
  })

  it('un tenant en TRIAL resuelve como cualquier otro', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
    })
    await expect(render()).resolves.toBeTruthy()
  })

  it('el apex no es 404 ni tenant', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'apex' })
    await expect(render()).resolves.toBeTruthy()
    expect(notFound).not.toHaveBeenCalled()
    expect(forbidden).not.toHaveBeenCalled()
  })
})
