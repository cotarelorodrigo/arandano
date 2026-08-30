import { describe, it, expect, vi, beforeEach } from 'vitest'

const exigirDuenio = vi.fn()
const exigirPermiso = vi.fn()
vi.mock('@/lib/auth/sesion', () => ({ exigirDuenio: () => exigirDuenio() }))
vi.mock('@/lib/permisos/guarda', () => ({ exigirPermiso: (p: string) => exigirPermiso(p) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const generarEnlace = vi.fn()
const confirmarNumero = vi.fn()
const desconectar = vi.fn()
const alternarActivo = vi.fn()
const guardarInstrucciones = vi.fn()
vi.mock('@/lib/bot/administrar', () => ({
  generarEnlace: (...a: unknown[]) => generarEnlace(...a),
  confirmarNumero: (...a: unknown[]) => confirmarNumero(...a),
  desconectar: (...a: unknown[]) => desconectar(...a),
  alternarActivo: (...a: unknown[]) => alternarActivo(...a),
  guardarInstrucciones: (...a: unknown[]) => guardarInstrucciones(...a),
}))

const SESION = {
  tenant: { id: 'tenant-1', nombre: 'Celulares Flor' },
  subdominio: 'flor',
  usuario: { rol: 'DUENO' },
}

const acciones = await import('./acciones')

beforeEach(() => {
  vi.clearAllMocks()
  exigirDuenio.mockResolvedValue(SESION)
  exigirPermiso.mockResolvedValue(SESION)
  generarEnlace.mockResolvedValue('https://app.kapso.ai/whatsapp/setup/abc')
})

/**
 * Cada acción re-exige lo suyo, y el reparto NO es uniforme a propósito.
 *
 * Que la pantalla no se muestre no es una defensa: una server action es un
 * endpoint y se invoca sin pasar por la pantalla. Y conectar/desconectar mueven
 * la identidad de WhatsApp del local, así que son del dueño; prender, apagar y
 * editar operan el negocio, así que se delegan. Misma regla que separó
 * PLANES_PAGO de ARTICULOS_EDITAR.
 */
describe('los guards de las acciones de /bot', () => {
  it.each([
    ['generarEnlaceDeConexion', () => acciones.generarEnlaceDeConexion()],
    ['confirmarNumeroDelLocal', () => acciones.confirmarNumeroDelLocal('pn_1')],
    ['desconectarNumero', () => acciones.desconectarNumero()],
  ])('%s es sólo del dueño', async (_nombre, correr) => {
    await correr()
    expect(exigirDuenio).toHaveBeenCalledTimes(1)
    expect(exigirPermiso).not.toHaveBeenCalled()
  })

  it.each([
    ['prenderOApagar', () => acciones.prenderOApagar(true)],
    ['guardarInformacionDelLocal', () => acciones.guardarInformacionDelLocal('Abrimos 9 a 18')],
  ])('%s se delega con el permiso BOT', async (_nombre, correr) => {
    await correr()
    expect(exigirPermiso).toHaveBeenCalledWith('BOT')
    expect(exigirDuenio).not.toHaveBeenCalled()
  })

  it('un empleado que no es dueño no puede conectar: el guard corta antes', async () => {
    exigirDuenio.mockRejectedValue(new Error('forbidden'))
    await expect(acciones.generarEnlaceDeConexion()).rejects.toThrow()
    expect(generarEnlace, 'se generó un enlace sin ser dueño').not.toHaveBeenCalled()
  })

  it('un empleado sin BOT no puede prender el bot', async () => {
    exigirPermiso.mockRejectedValue(new Error('forbidden'))
    await expect(acciones.prenderOApagar(true)).rejects.toThrow()
    expect(alternarActivo, 'se prendió el bot sin permiso').not.toHaveBeenCalled()
  })
})

describe('lo que las acciones devuelven', () => {
  it('generar el enlace lo entrega para abrirlo', async () => {
    const r = await acciones.generarEnlaceDeConexion()
    expect(r.error).toBeNull()
    expect(r.enlace).toBe('https://app.kapso.ai/whatsapp/setup/abc')
  })

  it('pasa el número elegido tal cual, sin releerlo de un FormData', async () => {
    await acciones.confirmarNumeroDelLocal('pn_elegido')
    expect(confirmarNumero).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: 'pn_elegido', tenantId: 'tenant-1' }),
    )
  })

  it('el switch manda el booleano, no un texto', async () => {
    await acciones.prenderOApagar(false)
    expect(alternarActivo).toHaveBeenCalledWith('tenant-1', false)
  })

  /**
   * Un error corregible se muestra; cualquier otro se RELANZA para que llegue
   * al log en vez de quedar disfrazado de cartel en la pantalla.
   */
  it('un error de negocio se muestra y uno inesperado se relanza', async () => {
    const { ErrorDeBot } = await import('@/lib/bot/errores')
    guardarInstrucciones.mockRejectedValueOnce(new ErrorDeBot('INSTRUCCIONES_LARGAS', 'Muy largo.'))
    expect((await acciones.guardarInformacionDelLocal('x')).error).toBe('Muy largo.')

    guardarInstrucciones.mockRejectedValueOnce(new TypeError('undefined is not a function'))
    await expect(acciones.guardarInformacionDelLocal('x')).rejects.toThrow(TypeError)
  })
})
