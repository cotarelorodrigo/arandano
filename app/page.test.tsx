import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const tenantDelRequest = vi.fn()
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: () => tenantDelRequest(),
}))

// exigirSesion se mockea acá y no se deja correr de verdad: su implementación
// real depende de headers(), de authParaTenant y de Postgres, que son detalle
// de otro módulo (ver lib/auth/sesion.test.ts). Lo único que a esta página le
// importa es: sin sesión redirige, con sesión trae un usuario.
const exigirSesion = vi.fn()
vi.mock('@/lib/auth/sesion', () => ({
  exigirSesion: () => exigirSesion(),
}))

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
const forbidden = vi.fn(() => {
  throw new Error('NEXT_FORBIDDEN')
})
const redirect = vi.fn((destino: string) => {
  throw new Error(`NEXT_REDIRECT:${destino}`)
})
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  forbidden: () => forbidden(),
  redirect: (destino: string) => redirect(destino),
}))

async function render() {
  const { default: Home } = await import('@/app/page')
  return Home()
}

describe('página raíz', () => {
  beforeEach(() => {
    vi.resetModules()
    tenantDelRequest.mockReset()
    exigirSesion.mockReset()
    notFound.mockClear()
    forbidden.mockClear()
    redirect.mockClear()
  })

  it('404 para un dominio ajeno', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'ajeno' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(exigirSesion).not.toHaveBeenCalled()
  })

  it('404 para un subdominio reservado', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'reservado', subdominio: 'admin' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(exigirSesion).not.toHaveBeenCalled()
  })

  it('404 para un subdominio inexistente', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'inexistente', subdominio: 'nadie' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(exigirSesion).not.toHaveBeenCalled()
  })

  // 403 y no 404, deliberadamente: son mensajes distintos para situaciones
  // distintas. Y antes de exigirSesion: un tenant suspendido no llega ni a
  // preguntar si hay sesión.
  it('403 para un tenant suspendido', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'SUSPENDIDO' },
    })
    await expect(render()).rejects.toThrow('NEXT_FORBIDDEN')
    expect(notFound).not.toHaveBeenCalled()
    expect(exigirSesion).not.toHaveBeenCalled()
  })

  // Con el guard puesto, un tenant sin sesión ya no renderiza nada de la home:
  // exigirSesion() es quien decide, y en la realidad redirige a /login (ver
  // lib/auth/sesion.ts). Acá se simula esa redirección con el mismo patrón que
  // notFound/forbidden más arriba, porque a esta página sólo le importa que
  // delega en exigirSesion antes de renderizar, no cómo exigirSesion redirige.
  it('sin sesión, / delega en exigirSesion (que redirige a /login)', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
    })
    exigirSesion.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT:/login')
    })
    await expect(render()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(notFound).not.toHaveBeenCalled()
    expect(forbidden).not.toHaveBeenCalled()
  })

  // El home dejó de ser una pantalla: es la aplicación abierta en la pestaña
  // por defecto. Lo que se afirma es el DESTINO, que es el contrato entero.
  it('con sesión, un tenant va a /vender', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
      subdominio: 'flor',
    })
    exigirSesion.mockResolvedValue({
      usuario: { id: 'u1', nombre: 'Ana', email: 'ana@flor.com', rol: 'EMPLEADO' },
    })
    await expect(render()).rejects.toThrow('NEXT_REDIRECT:/vender')
    expect(redirect).toHaveBeenCalledWith('/vender')
  })

  // El orden importa: un tenant suspendido tiene que ver el 403 y no ser
  // mandado a /vender para que otra cosa lo rebote sin explicar por qué.
  it('un tenant suspendido ve el 403, no el redirect', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'SUSPENDIDO' },
      subdominio: 'flor',
    })
    await expect(render()).rejects.toThrow('NEXT_FORBIDDEN')
    expect(redirect).not.toHaveBeenCalled()
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
    expect(exigirSesion).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
    const html = renderToStaticMarkup(elemento)
    expect(html).not.toContain('data-testid="tenant-nombre"')
  })
})
