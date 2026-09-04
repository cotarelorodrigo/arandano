import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hexDelToken } from '@/scripts/tokens.mts'

const tenantDelRequest = vi.fn()
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: () => tenantDelRequest(),
}))

// notFound() tira una excepción de control que en producción atrapa Next. Acá
// no hay framework que la atrape, así que se la mockea con una excepción
// reconocible: es la única forma de afirmar que el manifest CORTA, que es la
// mitad del comportamiento que este archivo tiene que fijar.
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

async function manifestPara(resolucion: unknown) {
  tenantDelRequest.mockResolvedValue(resolucion)
  const { default: manifest } = await import('@/app/manifest')
  return manifest()
}

describe('el manifest es del local, no del producto', () => {
  beforeEach(() => {
    vi.resetModules()
    tenantDelRequest.mockReset()
  })

  it('un tenant se instala con el nombre de su local', async () => {
    const m = await manifestPara({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Flor Celulares', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    expect(m.name).toBe('Flor Celulares')
    expect(m.short_name).toBe('Flor Celulares')
  })

  // start_url es '/' y no '/vender' ni '/dashboard' a propósito: app/page.tsx
  // ya redirige por rol con destinoAlEntrar(). Un literal acá sería un CUARTO
  // lugar que puede discrepar de los otros tres, que es justo lo que el
  // docblock de esa función existe para impedir.
  it('abre en / y deja que el destino lo decida el rol', async () => {
    const m = await manifestPara({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    expect(m.start_url).toBe('/')
    expect(m.scope).toBe('/')
    expect(m.display).toBe('standalone')
  })

  it('los colores son los tokens reales y no un hex suelto', async () => {
    const m = await manifestPara({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    expect(m.theme_color).toBe(hexDelToken('--marca'))
    expect(m.background_color).toBe(hexDelToken('--background'))
  })

  // La otra mitad, y la que pasa desapercibida: un manifest que devuelve 200
  // siempre parece que anda. Las cuatro ramas que no son tenant tienen que
  // cortar — si no, la página de ventas del producto queda instalable como si
  // fuera el producto.
  it.each([
    ['el ápex', { tipo: 'apex' }],
    ['un subdominio reservado', { tipo: 'reservado', subdominio: 'admin' }],
    ['un subdominio inexistente', { tipo: 'inexistente', subdominio: 'nada' }],
    ['un host ajeno', { tipo: 'ajeno' }],
  ])('%s no tiene manifest', async (_nombre, resolucion) => {
    await expect(manifestPara(resolucion)).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
