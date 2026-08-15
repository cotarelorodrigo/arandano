import { describe, it, expect, vi, beforeEach } from 'vitest'

// Se mockea la sesión y el dominio: lo que este test prueba es el CONTRATO de
// la action —que exija sesión, que traduzca los errores de dominio a cartel y
// relance el resto—, no el motor, que ya tiene su propio test contra la base.
const exigirSesion = vi.fn()
const exigirDuenio = vi.fn()
const crearOrden = vi.fn()
const anularOrden = vi.fn()

vi.mock('@/lib/auth/sesion', () => ({ exigirSesion, exigirDuenio }))
vi.mock('@/lib/ordenes-de-trabajo/crear', () => ({ crearOrden }))
vi.mock('@/lib/ordenes-de-trabajo/operaciones', () => ({
  anularOrden,
  cambiarEstado: vi.fn(),
  guardarDiagnostico: vi.fn(),
}))
vi.mock('@/lib/clientes/administrar', () => ({ crearCliente: vi.fn(), buscarClientes: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const sesion = {
  tenant: { id: 't-1' },
  usuario: { id: 'u-1', rol: 'EMPLEADO' },
}

beforeEach(() => {
  vi.clearAllMocks()
  exigirSesion.mockResolvedValue(sesion)
  exigirDuenio.mockResolvedValue({ ...sesion, usuario: { id: 'u-1', rol: 'DUENO' } })
})

function formulario(campos: Record<string, string>): FormData {
  const d = new FormData()
  for (const [k, v] of Object.entries(campos)) d.append(k, v)
  return d
}

describe('recibirEquipo', () => {
  it('exige sesión antes de tocar nada', async () => {
    const { recibirEquipo } = await import('./acciones')
    exigirSesion.mockRejectedValueOnce(new Error('sin sesión'))
    await expect(recibirEquipo({ error: null, aviso: null }, formulario({}))).rejects.toThrow()
    expect(crearOrden).not.toHaveBeenCalled()
  })

  it('pasa el tenant y el usuario de la SESIÓN, no del formulario', async () => {
    const { recibirEquipo } = await import('./acciones')
    crearOrden.mockResolvedValue({ id: 'o-1', numero: 7 })
    await recibirEquipo(
      { error: null, aviso: null },
      formulario({
        clienteId: 'c-1',
        equipoMarca: 'Samsung',
        equipoModelo: 'A54',
        fallaDeclarada: 'no carga',
        // Un formulario alterado a mano manda esto; la action tiene que
        // ignorarlo por completo.
        tenantId: 't-ajeno',
        usuarioId: 'u-ajeno',
      }),
    )
    expect(crearOrden).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-1', usuarioId: 'u-1' }),
    )
  })

  it('muestra el error de dominio como cartel', async () => {
    const { ErrorDeOrden } = await import('@/lib/ordenes-de-trabajo/errores')
    const { recibirEquipo } = await import('./acciones')
    crearOrden.mockRejectedValue(new ErrorDeOrden('FALLA_VACIA', 'falta la falla'))
    const r = await recibirEquipo({ error: null, aviso: null }, formulario({ clienteId: 'c-1' }))
    expect(r.error).toBe('falta la falla')
  })

  it('relanza lo que NO es error de dominio', async () => {
    const { recibirEquipo } = await import('./acciones')
    // Tragarlo lo convertiría en un cartel rojo genérico y el bug no llegaría
    // nunca a Sentry.
    crearOrden.mockRejectedValue(new Error('la base se cayó'))
    await expect(
      recibirEquipo({ error: null, aviso: null }, formulario({ clienteId: 'c-1' })),
    ).rejects.toThrow('la base se cayó')
  })
})

describe('anular', () => {
  it('exige DUEÑO, no sólo sesión', async () => {
    const { anular } = await import('./acciones')
    exigirDuenio.mockRejectedValueOnce(new Error('403'))
    await expect(anular({ error: null, aviso: null }, formulario({ ordenId: 'o-1' }))).rejects.toThrow()
    expect(anularOrden).not.toHaveBeenCalled()
  })
})
