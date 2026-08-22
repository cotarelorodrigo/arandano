import { describe, it, expect, vi, beforeEach } from 'vitest'

// Se mockea la sesión y el dominio: lo que este test prueba es el CONTRATO de
// la action —que exija sesión, que traduzca los errores de dominio a cartel y
// relance el resto—, no el motor, que ya tiene su propio test contra la base.
const exigirSesion = vi.fn()
const exigirDuenio = vi.fn()
const crearOrden = vi.fn()
const anularOrden = vi.fn()
const cambiarEstado = vi.fn()
const guardarDiagnostico = vi.fn()

vi.mock('@/lib/auth/sesion', () => ({ exigirSesion, exigirDuenio }))
vi.mock('@/lib/ordenes-de-trabajo/crear', () => ({ crearOrden }))
vi.mock('@/lib/ordenes-de-trabajo/operaciones', () => ({
  anularOrden,
  cambiarEstado,
  guardarDiagnostico,
}))
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

  it('el cliente nuevo se le PASA a crearOrden, no se crea antes', async () => {
    // La action ya no da de alta al cliente por su cuenta: si lo hiciera, ese
    // alta comitearía antes de la orden y el segundo submit de un doble click
    // dejaría dos "Juan Pérez" para un solo equipo. Lo resuelve crearOrden,
    // adentro de su transacción y después del camino rápido de la clave.
    const { recibirEquipo } = await import('./acciones')
    crearOrden.mockResolvedValue({ id: 'o-1', numero: 7 })
    await recibirEquipo(
      { error: null, aviso: null },
      formulario({
        clienteNombre: 'Juan Pérez',
        clienteTelefono: '1155667788',
        equipoMarca: 'Samsung',
        equipoModelo: 'A54',
        fallaDeclarada: 'no carga',
      }),
    )
    expect(crearOrden).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteNuevo: { nombre: 'Juan Pérez', telefono: '1155667788' },
      }),
    )
    expect(crearOrden.mock.calls[0][0]).not.toHaveProperty('clienteId')
  })

  it('con un cliente elegido no manda cliente nuevo', async () => {
    const { recibirEquipo } = await import('./acciones')
    crearOrden.mockResolvedValue({ id: 'o-1', numero: 7 })
    await recibirEquipo(
      { error: null, aviso: null },
      formulario({ clienteId: 'c-1', equipoMarca: 'Samsung', equipoModelo: 'A54' }),
    )
    expect(crearOrden.mock.calls[0][0]).toMatchObject({ clienteId: 'c-1' })
    expect(crearOrden.mock.calls[0][0]).not.toHaveProperty('clienteNuevo')
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

describe('moverEstado', () => {
  it('exige sesión antes de tocar nada', async () => {
    const { moverEstado } = await import('./acciones')
    exigirSesion.mockRejectedValueOnce(new Error('sin sesión'))
    await expect(
      moverEstado(
        { error: null, aviso: null },
        formulario({ ordenId: 'o-1', hasta: 'PRESUPUESTADO' }),
      ),
    ).rejects.toThrow()
    expect(cambiarEstado).not.toHaveBeenCalled()
  })

  it('pasa el tenant y el usuario de la SESIÓN, no del formulario', async () => {
    const { moverEstado } = await import('./acciones')
    cambiarEstado.mockResolvedValue(undefined)
    await moverEstado(
      { error: null, aviso: null },
      formulario({
        ordenId: 'o-1',
        hasta: 'PRESUPUESTADO',
        // Un formulario alterado a mano manda esto; la action tiene que
        // ignorarlo por completo.
        tenantId: 't-ajeno',
        usuarioId: 'u-ajeno',
      }),
    )
    expect(cambiarEstado).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-1', usuarioId: 'u-1' }),
    )
  })

  // Hallazgo C1 de la review final: el campo "Nota (opcional)" había
  // desaparecido del paño de estado y con él el único escritor de
  // `EventoOrden.nota`. Este caso no existía —moverEstado leía `nota` desde
  // siempre, pero nadie lo probaba— y es lo que hubiera atrapado que el
  // formulario dejara de mandarla.
  it('con una nota tipeada, la pasa (recortada) a cambiarEstado', async () => {
    const { moverEstado } = await import('./acciones')
    cambiarEstado.mockResolvedValue(undefined)
    await moverEstado(
      { error: null, aviso: null },
      formulario({ ordenId: 'o-1', hasta: 'PRESUPUESTADO', nota: '  el cliente aceptó por WhatsApp  ' }),
    )
    expect(cambiarEstado).toHaveBeenCalledWith(
      expect.objectContaining({ nota: 'el cliente aceptó por WhatsApp' }),
    )
  })

  it('sin nota tipeada, manda null y no un string vacío', async () => {
    const { moverEstado } = await import('./acciones')
    cambiarEstado.mockResolvedValue(undefined)
    await moverEstado(
      { error: null, aviso: null },
      formulario({ ordenId: 'o-1', hasta: 'PRESUPUESTADO' }),
    )
    expect(cambiarEstado).toHaveBeenCalledWith(expect.objectContaining({ nota: null }))
  })

  it('rechaza un "hasta" inventado sin llegar a cambiarEstado', async () => {
    const { moverEstado } = await import('./acciones')
    const r = await moverEstado(
      { error: null, aviso: null },
      formulario({ ordenId: 'o-1', hasta: 'ESTADO_QUE_NO_EXISTE' }),
    )
    expect(r.error).toBeTruthy()
    // El guard esEstado corta ANTES de llamar a cambiarEstado: la transición
    // ni siquiera llega a revalidarse contra la base.
    expect(cambiarEstado).not.toHaveBeenCalled()
  })

  it('muestra el error de dominio como cartel', async () => {
    const { ErrorDeOrden } = await import('@/lib/ordenes-de-trabajo/errores')
    const { moverEstado } = await import('./acciones')
    cambiarEstado.mockRejectedValue(new ErrorDeOrden('TRANSICION_INVALIDA', 'ese salto no existe'))
    const r = await moverEstado(
      { error: null, aviso: null },
      formulario({ ordenId: 'o-1', hasta: 'PRESUPUESTADO' }),
    )
    expect(r.error).toBe('ese salto no existe')
  })

  it('relanza lo que NO es error de dominio', async () => {
    const { moverEstado } = await import('./acciones')
    cambiarEstado.mockRejectedValue(new Error('la base se cayó'))
    await expect(
      moverEstado(
        { error: null, aviso: null },
        formulario({ ordenId: 'o-1', hasta: 'PRESUPUESTADO' }),
      ),
    ).rejects.toThrow('la base se cayó')
  })
})

describe('diagnosticar', () => {
  it('exige sesión antes de tocar nada', async () => {
    const { diagnosticar } = await import('./acciones')
    exigirSesion.mockRejectedValueOnce(new Error('sin sesión'))
    await expect(
      diagnosticar(
        { error: null, aviso: null },
        formulario({ ordenId: 'o-1', diagnostico: 'pantalla rota' }),
      ),
    ).rejects.toThrow()
    expect(guardarDiagnostico).not.toHaveBeenCalled()
  })

  it('pasa el tenant y el usuario de la SESIÓN, no del formulario', async () => {
    const { diagnosticar } = await import('./acciones')
    guardarDiagnostico.mockResolvedValue(undefined)
    await diagnosticar(
      { error: null, aviso: null },
      formulario({
        ordenId: 'o-1',
        diagnostico: 'pantalla rota',
        montoEstimado: '1000',
        // Igual que arriba: la action no puede confiar en esto.
        tenantId: 't-ajeno',
        usuarioId: 'u-ajeno',
      }),
    )
    expect(guardarDiagnostico).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-1', usuarioId: 'u-1' }),
    )
  })

  it('muestra el error de dominio como cartel', async () => {
    const { ErrorDeOrden } = await import('@/lib/ordenes-de-trabajo/errores')
    const { diagnosticar } = await import('./acciones')
    guardarDiagnostico.mockRejectedValue(new ErrorDeOrden('MONTO_INVALIDO', 'el monto no sirve'))
    const r = await diagnosticar(
      { error: null, aviso: null },
      formulario({ ordenId: 'o-1', diagnostico: 'pantalla rota' }),
    )
    expect(r.error).toBe('el monto no sirve')
  })

  it('relanza lo que NO es error de dominio', async () => {
    const { diagnosticar } = await import('./acciones')
    guardarDiagnostico.mockRejectedValue(new Error('la base se cayó'))
    await expect(
      diagnosticar(
        { error: null, aviso: null },
        formulario({ ordenId: 'o-1', diagnostico: 'pantalla rota' }),
      ),
    ).rejects.toThrow('la base se cayó')
  })
})
