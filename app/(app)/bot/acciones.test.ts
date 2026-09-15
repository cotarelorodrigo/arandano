import { describe, it, expect, vi, beforeEach } from 'vitest'

const exigirDuenio = vi.fn()
const exigirPermiso = vi.fn()
vi.mock('@/lib/auth/sesion', () => ({ exigirDuenio: () => exigirDuenio() }))
vi.mock('@/lib/permisos/guarda', () => ({ exigirPermiso: (p: string) => exigirPermiso(p) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
vi.mock('next/navigation', () => ({ notFound: () => notFound() }))

const generarEnlace = vi.fn()
const confirmarNumero = vi.fn()
const desconectar = vi.fn()
const alternarActivo = vi.fn()
const guardarInformacion = vi.fn()
const cambiarModo = vi.fn()
const agregarNumeroDePrueba = vi.fn()
const quitarNumeroDePrueba = vi.fn()
vi.mock('@/lib/bot/administrar', () => ({
  generarEnlace: (...a: unknown[]) => generarEnlace(...a),
  confirmarNumero: (...a: unknown[]) => confirmarNumero(...a),
  desconectar: (...a: unknown[]) => desconectar(...a),
  alternarActivo: (...a: unknown[]) => alternarActivo(...a),
  guardarInformacion: (...a: unknown[]) => guardarInformacion(...a),
  cambiarModo: (...a: unknown[]) => cambiarModo(...a),
  agregarNumeroDePrueba: (...a: unknown[]) => agregarNumeroDePrueba(...a),
  quitarNumeroDePrueba: (...a: unknown[]) => quitarNumeroDePrueba(...a),
}))

const SESION = {
  tenant: { id: 'tenant-1', nombre: 'Celulares Flor' },
  subdominio: 'flor',
  usuario: { rol: 'DUENO' },
}

const acciones = await import('./acciones')

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.BOT_HABILITADO_EN
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
    ['guardarInformacionDelLocal', () => acciones.guardarInformacionDelLocal({ aQueSeDedica: 'una waflería', instrucciones: 'Abrimos 9 a 18' })],
    ['cambiarModoDelBot', () => acciones.cambiarModoDelBot('PRUEBA')],
    ['agregarNumeroDePruebaDelLocal', () => acciones.agregarNumeroDePruebaDelLocal('11 2233-4455')],
    ['quitarNumeroDePruebaDelLocal', () => acciones.quitarNumeroDePruebaDelLocal('0190a1b2-0000-7000-8000-000000000000')],
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

  it.each([
    ['cambiarModoDelBot', () => acciones.cambiarModoDelBot('TODOS'), () => cambiarModo],
    ['agregarNumeroDePruebaDelLocal', () => acciones.agregarNumeroDePruebaDelLocal('11 2233-4455'), () => agregarNumeroDePrueba],
    ['quitarNumeroDePruebaDelLocal', () => acciones.quitarNumeroDePruebaDelLocal('x'), () => quitarNumeroDePrueba],
  ])('un empleado sin BOT no puede %s', async (_n, correr, efecto) => {
    exigirPermiso.mockRejectedValue(new Error('forbidden'))
    await expect(correr()).rejects.toThrow()
    expect(efecto(), 'la acción corrió sin el permiso BOT').not.toHaveBeenCalled()
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

  it('guarda los dos campos del local, no sólo el textarea', async () => {
    await acciones.guardarInformacionDelLocal({
      aQueSeDedica: 'una waflería',
      instrucciones: 'Abrimos de 9 a 18.',
    })
    expect(guardarInformacion).toHaveBeenCalledWith('tenant-1', {
      aQueSeDedica: 'una waflería',
      instrucciones: 'Abrimos de 9 a 18.',
    })
  })

  it('el switch manda el booleano, no un texto', async () => {
    await acciones.prenderOApagar(false)
    expect(alternarActivo).toHaveBeenCalledWith('tenant-1', false)
  })

  it('el modo viaja tal cual; lo valida administrar', async () => {
    await acciones.cambiarModoDelBot('PRUEBA')
    expect(cambiarModo).toHaveBeenCalledWith('tenant-1', 'PRUEBA')
  })

  it('cada modo avisa lo que va a pasar con el próximo mensaje', async () => {
    expect((await acciones.cambiarModoDelBot('APAGADO')).aviso).toBe('El bot dejó de contestar.')
    expect((await acciones.cambiarModoDelBot('PRUEBA')).aviso).toBe(
      'El bot contesta sólo a los números de prueba.',
    )
    expect((await acciones.cambiarModoDelBot('TODOS')).aviso).toBe('El bot les contesta a todos.')
  })

  it('agregar pasa el texto tipeado y quitar el id', async () => {
    await acciones.agregarNumeroDePruebaDelLocal('11 2233-4455')
    expect(agregarNumeroDePrueba).toHaveBeenCalledWith('tenant-1', '11 2233-4455')
    await acciones.quitarNumeroDePruebaDelLocal('id-1')
    expect(quitarNumeroDePrueba).toHaveBeenCalledWith('tenant-1', 'id-1')
  })

  it('un número repetido se muestra como error, no se relanza', async () => {
    const { ErrorDeBot } = await import('@/lib/bot/errores')
    agregarNumeroDePrueba.mockRejectedValueOnce(
      new ErrorDeBot('NUMERO_REPETIDO', 'Ese número ya está en la lista de prueba.'),
    )
    const r = await acciones.agregarNumeroDePruebaDelLocal('11 2233-4455')
    expect(r.error).toBe('Ese número ya está en la lista de prueba.')
  })

  /**
   * Un error corregible se muestra; cualquier otro se RELANZA para que llegue
   * al log en vez de quedar disfrazado de cartel en la pantalla.
   */
  it('un error de negocio se muestra y uno inesperado se relanza', async () => {
    const { ErrorDeBot } = await import('@/lib/bot/errores')
    guardarInformacion.mockRejectedValueOnce(new ErrorDeBot('INSTRUCCIONES_LARGAS', 'Muy largo.'))
    expect((await acciones.guardarInformacionDelLocal({ aQueSeDedica: '', instrucciones: 'x' })).error).toBe('Muy largo.')

    guardarInformacion.mockRejectedValueOnce(new TypeError('undefined is not a function'))
    await expect(acciones.guardarInformacionDelLocal({ aQueSeDedica: '', instrucciones: 'x' })).rejects.toThrow(TypeError)
  })
})

/**
 * El gate del rollout —`BOT_HABILITADO_EN`— tiene que alcanzar a las CINCO
 * acciones, no sólo a la pantalla.
 *
 * Es la misma lección que el merge del ciclo móvil dejó escrita para las dos
 * copias de un botón: una guarda que cubre una sola de las puertas no es una
 * guarda. Acá la puerta que se olvida es la de siempre — una server action es
 * un endpoint y se invoca sin pasar por la pantalla que la esconde.
 *
 * El caso cuenta en las DOS direcciones (fuera de la lista no corre, adentro
 * sí): un `rejects.toThrow()` solo pasaría igual si el gate rechazara SIEMPRE,
 * y eso dejaría al local habilitado sin bot y con el gate en verde.
 */
describe('el gate del rollout alcanza a todas las acciones', () => {
  const TODAS: [string, () => Promise<unknown>, ReturnType<typeof vi.fn>][] = [
    ['generarEnlaceDeConexion', () => acciones.generarEnlaceDeConexion(), generarEnlace],
    ['confirmarNumeroDelLocal', () => acciones.confirmarNumeroDelLocal('pn_1'), confirmarNumero],
    ['desconectarNumero', () => acciones.desconectarNumero(), desconectar],
    ['prenderOApagar', () => acciones.prenderOApagar(true), alternarActivo],
    [
      'guardarInformacionDelLocal',
      () => acciones.guardarInformacionDelLocal({ aQueSeDedica: 'una waflería', instrucciones: 'Abrimos 9 a 18' }),
      guardarInformacion,
    ],
  ]

  it.each(TODAS)('%s no hace nada en un local fuera de la lista', async (_n, correr, efecto) => {
    process.env.BOT_HABILITADO_EN = 'wafflespro' // la sesión de arriba es 'flor'
    await expect(correr()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(efecto, 'la acción corrió en un local sin el bot habilitado').not.toHaveBeenCalled()
  })

  it.each(TODAS)('%s sí corre en el local de la lista', async (_n, correr, efecto) => {
    process.env.BOT_HABILITADO_EN = 'flor'
    await correr()
    expect(efecto).toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })
})
