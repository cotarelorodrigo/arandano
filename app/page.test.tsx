import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

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

  // toBeTruthy() no alcanza acá: cualquier elemento JSX es truthy, así que un
  // tenant hardcodeado o el equivocado hubiera pasado igual. Se afirma sobre
  // el HTML que realmente sale — el mismo criterio que usa caso_tenant_resuelve
  // en scripts/smoke.sh — para distinguir de verdad PaginaTenant de PaginaApex
  // y confirmar que el nombre que se ve es el del tenant resuelto.
  it('un tenant en TRIAL resuelve como cualquier otro, con su propio nombre', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
    })
    const elemento = await render()
    const html = renderToStaticMarkup(elemento)
    expect(html).toContain('data-testid="tenant-nombre">Flor')
    expect(html).toContain('data-testid="tenant-estado">TRIAL')
  })

  // Mismo criterio que caso_home_responde en scripts/smoke.sh tras el fix de
  // review: el apex no sólo tiene que evitar notFound()/forbidden(), el
  // cuerpo tiene que estar libre de los testids de una página de tenant. Un
  // apex que por error resolviera a un tenant hubiera pasado la aserción
  // vieja igual.
  it('el apex no es 404 ni tenant', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'apex' })
    const elemento = await render()
    expect(notFound).not.toHaveBeenCalled()
    expect(forbidden).not.toHaveBeenCalled()
    const html = renderToStaticMarkup(elemento)
    expect(html).not.toContain('data-testid="tenant-nombre"')
  })
})
