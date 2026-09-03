import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * El guard de la única acción de esta pantalla.
 *
 * **Que la pantalla no se muestre no es una defensa**: una server action es un
 * endpoint y se invoca sin pasar por la pantalla. Es la misma lección que ya
 * dejó escrita el ciclo del bot con sus cinco puertas, y por la que
 * `exportarVentas` re-exige por su cuenta en vez de confiar en que `page.tsx`
 * ya cortó.
 *
 * `exigirDuenio` y no `exigirPermiso`: el tablero agrega la facturación del
 * local, y el dueño del producto decidió (2026-09-03) que eso no se delega
 * —ni siquiera con un permiso nuevo—, así que no hay switch que otorgar. Es
 * el mismo tratamiento que `/usuarios`.
 */
const exigirDuenio = vi.fn()
vi.mock('@/lib/auth/sesion', () => ({ exigirDuenio: () => exigirDuenio() }))

const findMany = vi.fn()
vi.mock('@/lib/tenant/prisma', () => ({
  prismaParaTenant: () => ({ venta: { findMany: (...a: unknown[]) => findMany(...a) } }),
}))

const SESION = {
  tenant: { id: 'tenant-1', nombre: 'Celulares Flor' },
  subdominio: 'canario',
  usuario: { rol: 'DUENO' },
}

const { exportarVentas } = await import('./acciones')

beforeEach(() => {
  vi.clearAllMocks()
  exigirDuenio.mockResolvedValue(SESION)
  findMany.mockResolvedValue([])
})

describe('el guard de exportarVentas', () => {
  it('exige ser dueño', async () => {
    await exportarVentas('estemes')
    expect(exigirDuenio).toHaveBeenCalledTimes(1)
  })

  // La dirección que importa: sin este caso, un guard que se llamara y no
  // cortara pasaría el de arriba en verde.
  it('un empleado no se lleva el CSV: el guard corta antes de consultar', async () => {
    exigirDuenio.mockRejectedValue(new Error('forbidden'))
    await expect(exportarVentas('estemes')).rejects.toThrow()
    expect(findMany, 'se consultaron las ventas sin ser dueño').not.toHaveBeenCalled()
  })
})
