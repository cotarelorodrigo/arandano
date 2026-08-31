import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'

const SECRETO = 'secreto-del-local'
const PHONE_ID = '123456789012345'

const tenantDelRequest = vi.fn()
const buscarBot = vi.fn()
const registrarEntrante = vi.fn()
const respuestasDelMes = vi.fn()
const respuestasDeLaUltimaHora = vi.fn()
const procesarMensaje = vi.fn()
const agendado = vi.fn()

vi.mock('@/lib/tenant/desde-request', () => ({ tenantDelRequest: () => tenantDelRequest() }))
vi.mock('@/lib/tenant/prisma', () => ({
  prismaParaTenant: () => ({ botDeWhatsapp: { findUnique: () => buscarBot() } }),
}))
vi.mock('@/lib/bot/conversaciones', () => ({
  registrarEntrante: (...a: unknown[]) => registrarEntrante(...a),
}))
vi.mock('@/lib/bot/limites', async (original) => ({
  ...(await original<typeof import('@/lib/bot/limites')>()),
  respuestasDelMes: () => respuestasDelMes(),
  respuestasDeLaUltimaHora: () => respuestasDeLaUltimaHora(),
}))
vi.mock('@/lib/bot/procesar', () => ({
  procesarMensaje: (...a: unknown[]) => procesarMensaje(...a),
}))
// `after` se espía en vez de ejecutarse: lo que este archivo tiene que afirmar
// es QUÉ se agenda y cuándo, no lo que hace el trabajo agendado (eso es
// lib/bot/procesar.ts). Ejecutarlo acá metería el modelo y la red en un test.
vi.mock('next/server', () => ({ after: (fn: () => unknown) => agendado(fn) }))

const { POST } = await import('./route')

const CUERPO = JSON.stringify({
  phone_number_id: PHONE_ID,
  message: {
    id: 'wamid.ABC',
    type: 'text',
    text: { body: '¿tenés fundas?' },
    kapso: { direction: 'inbound', content: '¿tenés fundas?' },
  },
  conversation: { id: 'conv_1', phone_number: '+5491155550000', kapso: { contact_name: 'Ana' } },
})

function pedido(cuerpo = CUERPO, firma?: string | null) {
  const cabeceras = new Headers()
  const valor =
    firma === undefined ? createHmac('sha256', SECRETO).update(cuerpo, 'utf8').digest('hex') : firma
  if (valor !== null) cabeceras.set('x-webhook-signature', valor)
  return new Request('https://flor.arandano.app/api/whatsapp/webhook', {
    method: 'POST',
    body: cuerpo,
    headers: cabeceras,
  })
}

const BOT_CONECTADO = {
  phoneNumberId: PHONE_ID,
  numeroVisible: '+5491166660000',
  webhookSecreto: SECRETO,
  activo: true,
  instrucciones: 'Abrimos de 9 a 18.',
  topeMensual: 1000,
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.BOT_HABILITADO_EN
  process.env.ANTHROPIC_API_KEY = 'sk-test'
  tenantDelRequest.mockResolvedValue({
    tipo: 'tenant',
    subdominio: 'flor',
    tenant: { id: 'tenant-1', nombre: 'Celulares Flor', estado: 'ACTIVO' },
  })
  buscarBot.mockResolvedValue(BOT_CONECTADO)
  registrarEntrante.mockResolvedValue({ conversacionId: 'conv-fila-1', esNuevo: true })
  respuestasDelMes.mockResolvedValue(0)
  respuestasDeLaUltimaHora.mockResolvedValue(0)
})

describe('el webhook de WhatsApp', () => {
  it('con todo en orden: 200, guarda el entrante y agenda la respuesta', async () => {
    const r = await POST(pedido())
    expect(r.status).toBe(200)
    expect(registrarEntrante).toHaveBeenCalledTimes(1)
    expect(agendado).toHaveBeenCalledTimes(1)
  })

  /**
   * Todo rechazo se ve igual desde afuera: 404 genérico y ninguna escritura.
   * Un 401 confirmaría que existe un modo autenticado y que vale insistir.
   */
  it.each([
    ['la firma es de otro secreto', () => pedido(CUERPO, createHmac('sha256', 'otro').update(CUERPO).digest('hex'))],
    ['no viene firma', () => pedido(CUERPO, null)],
    ['el cuerpo fue alterado después de firmar', () => pedido(CUERPO.replace('Ana', 'Eva'), createHmac('sha256', SECRETO).update(CUERPO).digest('hex'))],
  ])('rechaza con 404 y sin escribir cuando %s', async (_caso, armar) => {
    const r = await POST(armar())
    expect(r.status).toBe(404)
    expect(registrarEntrante, 'se escribió una fila con la firma inválida').not.toHaveBeenCalled()
    expect(agendado).not.toHaveBeenCalled()
  })

  it('404 si el Host no es de ningún tenant', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'inexistente', subdominio: 'nadie' })
    expect((await POST(pedido())).status).toBe(404)
    expect(registrarEntrante).not.toHaveBeenCalled()
  })

  it('404 si el tenant está suspendido', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      subdominio: 'flor',
      tenant: { id: 'tenant-1', nombre: 'Flor', estado: 'SUSPENDIDO' },
    })
    expect((await POST(pedido())).status).toBe(404)
  })

  it('404 si el local no tiene número conectado', async () => {
    buscarBot.mockResolvedValue(null)
    expect((await POST(pedido())).status).toBe(404)
  })

  /**
   * El gate del rollout, cerrando el círculo por la última puerta.
   *
   * Hoy es redundante —un local fuera de la lista nunca pudo conectar un número,
   * así que Kapso no le manda nada— y va igual: es la misma línea que las otras
   * cuatro puertas, y deja el bot apagado de punta a punta en vez de apoyado en
   * que nadie haya conectado nada. Si mañana se saca un local de la lista sin
   * desconectarlo, el bot deja de contestar en el acto.
   */
  it('404 y sin escribir si el local no tiene el bot habilitado', async () => {
    process.env.BOT_HABILITADO_EN = 'wafflespro' // el Host del pedido es flor
    const r = await POST(pedido())
    expect(r.status).toBe(404)
    expect(registrarEntrante, 'se guardó un mensaje de un local sin bot').not.toHaveBeenCalled()
    expect(agendado).not.toHaveBeenCalled()
  })

  it('contesta normalmente en el local que sí está en la lista', async () => {
    process.env.BOT_HABILITADO_EN = 'flor'
    expect((await POST(pedido())).status).toBe(200)
    expect(agendado).toHaveBeenCalledTimes(1)
  })

  /**
   * El segundo factor. La firma dice "lo mandó Kapso"; esto dice "y es de ESTE
   * local". Sin el cruce, el secreto de un tenant serviría para meterle
   * mensajes al bot de otro.
   */
  it('404 si el phone_number_id del payload no es el del local', async () => {
    const ajeno = CUERPO.replace(PHONE_ID, '999999999999999')
    const r = await POST(pedido(ajeno))
    expect(r.status).toBe(404)
    expect(registrarEntrante).not.toHaveBeenCalled()
  })

  /**
   * El reintento de Kapso (10 s, 40 s, 90 s) trae el mismo wamid. La segunda vez
   * `registrarEntrante` avisa que la fila ya estaba, y no se contesta de nuevo.
   * Es el mismo mecanismo que Venta.claveIdempotencia.
   */
  it('un reintento con el mismo wamid no vuelve a contestar', async () => {
    registrarEntrante.mockResolvedValue({ conversacionId: 'conv-fila-1', esNuevo: false })
    const r = await POST(pedido())
    expect(r.status).toBe(200)
    expect(agendado, 'se contestó dos veces el mismo mensaje').not.toHaveBeenCalled()
  })

  describe('los cortes: guarda siempre, contesta según', () => {
    const noContesta = async (motivoEsperado: string) => {
      const r = await POST(pedido())
      expect(r.status).toBe(200)
      expect(registrarEntrante, 'el mensaje no quedó registrado').toHaveBeenCalledTimes(1)
      expect(registrarEntrante.mock.calls[0][1]).toMatchObject({ motivo: motivoEsperado })
      expect(agendado).not.toHaveBeenCalled()
    }

    it('con el bot apagado guarda y calla', async () => {
      buscarBot.mockResolvedValue({ ...BOT_CONECTADO, activo: false })
      await noContesta('BOT_APAGADO')
    })

    it('con el tope mensual alcanzado guarda y calla', async () => {
      respuestasDelMes.mockResolvedValue(1000)
      await noContesta('TOPE_MENSUAL')
    })

    it('con demasiadas respuestas en la última hora guarda y calla', async () => {
      respuestasDeLaUltimaHora.mockResolvedValue(12)
      await noContesta('TOPE_CONVERSACION')
    })

    it('sin ANTHROPIC_API_KEY guarda y calla', async () => {
      delete process.env.ANTHROPIC_API_KEY
      await noContesta('SIN_MODELO')
    })

    it('un mensaje sin texto (un sticker) se guarda y no se contesta', async () => {
      const sticker = JSON.stringify({
        phone_number_id: PHONE_ID,
        message: { id: 'wamid.S', type: 'sticker', kapso: { direction: 'inbound', has_media: true } },
        conversation: { id: 'conv_1', phone_number: '+5491155550000' },
      })
      const r = await POST(pedido(sticker))
      expect(r.status).toBe(200)
      expect(registrarEntrante.mock.calls[0][1]).toMatchObject({ motivo: 'SIN_TEXTO' })
      expect(agendado).not.toHaveBeenCalled()
    })
  })

  /**
   * En coexistencia el dueño sigue contestando desde su celular y ese mensaje
   * también entra. Sin este guard, el bot podría responderse a sí mismo.
   */
  it('ignora por completo un mensaje que viene del propio número del local', async () => {
    const propio = CUERPO.replace('+5491155550000', '+5491166660000')
    const r = await POST(pedido(propio))
    expect(r.status).toBe(200)
    expect(registrarEntrante).not.toHaveBeenCalled()
    expect(agendado).not.toHaveBeenCalled()
  })

  it('con firma válida y JSON ilegible devuelve 200: reintentar no lo arregla', async () => {
    const roto = '{ esto no es json'
    const r = await POST(pedido(roto))
    expect(r.status).toBe(200)
    expect(registrarEntrante).not.toHaveBeenCalled()
  })

  it('un lote agrupado registra los dos mensajes', async () => {
    const lote = JSON.stringify({
      phone_number_id: PHONE_ID,
      conversation: { id: 'conv_1', phone_number: '+5491155550000' },
      messages: [
        { id: 'wamid.1', type: 'text', kapso: { direction: 'inbound', content: 'hola' } },
        { id: 'wamid.2', type: 'text', kapso: { direction: 'inbound', content: 'tenés fundas?' } },
      ],
    })
    const r = await POST(pedido(lote))
    expect(r.status).toBe(200)
    expect(registrarEntrante).toHaveBeenCalledTimes(2)
  })

  /** Nada de red antes del 200: el agente sólo se agenda, nunca se espera. */
  it('no espera al agente: el trabajo queda agendado, no ejecutado', async () => {
    await POST(pedido())
    expect(procesarMensaje, 'el handler ejecutó el agente en línea').not.toHaveBeenCalled()
    expect(agendado).toHaveBeenCalledTimes(1)
  })
})
