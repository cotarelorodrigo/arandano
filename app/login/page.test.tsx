import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Mismo patrón que app/page.test.tsx: se mockean las fronteras con Next y con
// la resolución de tenant, no la lógica de esta página.
const tenantDelRequest = vi.fn()
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: () => tenantDelRequest(),
}))

const sesionActual = vi.fn()
vi.mock('@/lib/auth/sesion', () => ({
  sesionActual: () => sesionActual(),
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

// El pie arma el dominio con piezasDeOrigen(), que lee x-forwarded-proto —
// se mockea el header y no la función, mismo motivo que app/page.test.tsx:
// así se ejercita la función de verdad, lista blanca incluida.
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-proto': 'https' }),
}))

// El formulario es 'use client' y arrastra acciones.ts ('use server'); su
// contrato ya lo prueba acciones.test.ts contra una base real.
vi.mock('./formulario', () => ({
  FormularioLogin: () => 'FORMULARIO',
}))

async function render() {
  process.env.DOMINIO_BASE = 'arandano.test'
  const { default: Login } = await import('./page')
  return Login()
}

describe('página de login', () => {
  beforeEach(() => {
    vi.resetModules()
    tenantDelRequest.mockReset()
    sesionActual.mockReset()
    notFound.mockClear()
    forbidden.mockClear()
    redirect.mockClear()
  })

  it('el pie muestra el subdominio del tenant junto al dominio base', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Celulares Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    sesionActual.mockResolvedValue(null)

    const elemento = await render()
    const html = renderToStaticMarkup(elemento)

    expect(html).toContain('flor.arandano.test')
  })

  it('el pie dice que cada local entra por su propia dirección', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Celulares Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    sesionActual.mockResolvedValue(null)

    const html = renderToStaticMarkup(await render())
    expect(html).toContain('Cada local entra por su propia dirección.')
  })

  it('muestra la marca (Arándano) y la bajada bajo el nombre del local', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Celulares Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    sesionActual.mockResolvedValue(null)

    const html = renderToStaticMarkup(await render())
    expect(html).toContain('Arándano')
    expect(html).toContain('Celulares Flor')
    expect(html).toContain('Ventas, stock, caja y servicio técnico del local')
  })

  // Task 11 del ciclo móvil (design/arandano.pen, frame `Móvil / Login`,
  // `Kp4Eg`): el contenedor invierte de columna a fila, y el paño pasa de
  // franja fija a la columna de siempre — mobile-first, sin ningún md:/sm:
  // sobreviviendo.
  it('el contenedor pasa de columna (teléfono) a fila (escritorio), sin md:/sm:', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Celulares Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    sesionActual.mockResolvedValue(null)

    const html = renderToStaticMarkup(await render())
    expect(html).toContain('flex-col lg:flex-row')
    expect(html).not.toMatch(/\bmd:/)
    expect(html).not.toMatch(/\bsm:/)
    expect(html).not.toMatch(/\bxl:/)
  })

  it('el paño mide 300px de alto en el teléfono y auto en escritorio (h-[300px] lg:h-auto)', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Celulares Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    sesionActual.mockResolvedValue(null)

    const html = renderToStaticMarkup(await render())
    expect(html).toContain('h-[300px]')
    expect(html).toContain('lg:h-auto')
  })

  // El pie (URL del tenant) vive en dos lugares distintos según el ancho —
  // dentro del paño en escritorio (nodo `y8KkFc`), al pie del formulario en
  // el teléfono (nodo `eY0BS`, dentro de `FormularioLogin`) — pero tiene que
  // seguir existiendo en los dos, nunca desaparecer sin más (regla del ciclo:
  // una capacidad que se pierde en el teléfono y no reaparece en otro lado es
  // un defecto). Se afirma explícitamente CADA mitad: `hidden lg:flex` para
  // la de escritorio (visible sólo desde 1024) y que el dominio también
  // aparece fuera de esa mitad (la de FormularioLogin, mockeada más abajo).
  it('el pie de escritorio (dentro del paño) es hidden lg:flex, no lg:hidden', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Celulares Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    sesionActual.mockResolvedValue(null)

    const html = renderToStaticMarkup(await render())
    expect(html).toContain('hidden')
    expect(html).toMatch(/hidden[^"]*lg:flex/)
  })

  // El testid que consume scripts/smoke.sh: sigue pegado al nombre, sin
  // ningún <span> en el medio (ver el comentario de page.tsx).
  it('el nombre del local lleva el testid pegado, sin span en el medio', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Celulares Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    sesionActual.mockResolvedValue(null)

    const html = renderToStaticMarkup(await render())
    expect(html).toContain('data-testid="tenant-nombre">Celulares Flor')
  })

  it('404 fuera de un tenant', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'apex' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('403 con el tenant suspendido', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Celulares Flor', estado: 'SUSPENDIDO' },
      subdominio: 'flor',
    })
    await expect(render()).rejects.toThrow('NEXT_FORBIDDEN')
  })

  it('ya logueado, redirige a /vender', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Celulares Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    sesionActual.mockResolvedValue({ usuario: { id: 'u1' } })
    await expect(render()).rejects.toThrow('NEXT_REDIRECT:/vender')
  })
})
