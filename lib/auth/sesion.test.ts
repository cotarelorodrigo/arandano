import { describe, it, expect, vi, beforeEach } from 'vitest'

const estado = vi.hoisted(() => ({
  resolucion: null as unknown,
  usuario: null as unknown,
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => estado.resolucion,
}))
vi.mock('@/lib/auth/origen', () => ({ origenDelRequest: async () => 'http://x.test' }))
vi.mock('@/lib/auth/para-tenant', () => ({
  authParaTenant: () => ({ api: { getSession: async () => (estado.usuario ? { user: estado.usuario } : null) } }),
}))

const redirigido = vi.hoisted(() => vi.fn(() => { throw new Error('REDIRECT') }))
const prohibido = vi.hoisted(() => vi.fn(() => { throw new Error('FORBIDDEN') }))
vi.mock('next/navigation', () => ({ redirect: redirigido, forbidden: prohibido }))

const { sesionActual, exigirSesion, exigirDuenio } = await import('./sesion')

const TENANT = { tipo: 'tenant', tenant: { id: 't1', nombre: 'Flor', estado: 'ACTIVO' }, subdominio: 'flor' }
const ACTIVO = { id: 'u1', name: 'Juan', email: 'j@x.test', rol: 'EMPLEADO', desactivadoEn: null }

beforeEach(() => {
  estado.resolucion = TENANT
  estado.usuario = ACTIVO
  redirigido.mockClear()
  prohibido.mockClear()
})

describe('sesionActual', () => {
  it('devuelve la sesión cuando todo está bien', async () => {
    const s = await sesionActual()
    expect(s?.usuario.email).toBe('j@x.test')
    expect(s?.subdominio).toBe('flor')
  })

  it('es null sin sesión', async () => {
    estado.usuario = null
    expect(await sesionActual()).toBeNull()
  })

  it('es null si el usuario está desactivado', async () => {
    estado.usuario = { ...ACTIVO, desactivadoEn: new Date() }
    expect(await sesionActual()).toBeNull()
  })

  it('es null fuera de un tenant', async () => {
    estado.resolucion = { tipo: 'apex' }
    expect(await sesionActual()).toBeNull()
  })

  it('es null si el local está suspendido', async () => {
    estado.resolucion = { ...TENANT, tenant: { ...TENANT.tenant, estado: 'SUSPENDIDO' } }
    expect(await sesionActual()).toBeNull()
  })
})

describe('exigirSesion', () => {
  it('manda al login cuando no hay sesión', async () => {
    estado.usuario = null
    await expect(exigirSesion()).rejects.toThrow('REDIRECT')
    expect(redirigido).toHaveBeenCalledWith('/login')
  })
})

describe('exigirDuenio', () => {
  it('un EMPLEADO no pasa', async () => {
    // Es lo que impide que un empleado abra /usuarios y se dé de alta a sí
    // mismo como dueño.
    await expect(exigirDuenio()).rejects.toThrow('FORBIDDEN')
    expect(prohibido).toHaveBeenCalled()
  })

  it('un DUENO pasa', async () => {
    estado.usuario = { ...ACTIVO, rol: 'DUENO' }
    expect((await exigirDuenio()).usuario.rol).toBe('DUENO')
    expect(prohibido).not.toHaveBeenCalled()
  })
})
