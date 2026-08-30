import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { crearWebhookDeMensajes, enviarTexto, kapsoConfigurado, ErrorDeKapso } from '@/lib/bot/kapso'

const fetchFalso = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchFalso)
  fetchFalso.mockReset()
  process.env.KAPSO_API_KEY = 'clave-de-prueba'
  process.env.KAPSO_API_BASE_URL = 'https://kapso.example'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function respuesta(cuerpo: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(cuerpo),
  } as Response
}

const llamada = () => {
  const [url, init] = fetchFalso.mock.calls[0] as [URL, RequestInit]
  return { url: url.toString(), init, body: JSON.parse(String(init.body)) }
}

describe('crear el webhook de mensajes', () => {
  /**
   * EL hallazgo de la primera conexión real contra la API de Kapso: **el
   * secreto no lo genera Kapso**. Crear el webhook sin `secret_key` devuelve
   * `422 {"error":"Secret key can't be blank"}`.
   *
   * Este caso fija que lo mandamos, porque el modo de falla de no hacerlo es
   * silencioso en el peor momento: el bot queda conectado y sordo —ningún
   * webhook validaría nunca su firma— y eso recién se ve cuando un cliente
   * escribe y nadie contesta.
   */
  it('genera el secreto y se lo MANDA a Kapso', async () => {
    fetchFalso.mockResolvedValue(respuesta({ data: { id: 'wh_1' } }))
    const r = await crearWebhookDeMensajes({ phoneNumberId: 'pn_1', url: 'https://x.test/hook' })

    expect(llamada().body.whatsapp_webhook.secret_key).toBe(r.secreto)
    expect(r.secreto, 'el secreto tiene que ser largo y aleatorio').toMatch(/^[0-9a-f]{64}$/)
  })

  it('el secreto es distinto en cada webhook', async () => {
    fetchFalso.mockResolvedValue(respuesta({ data: { id: 'wh_1' } }))
    const a = await crearWebhookDeMensajes({ phoneNumberId: 'pn_1', url: 'https://x.test/hook' })
    const b = await crearWebhookDeMensajes({ phoneNumberId: 'pn_2', url: 'https://x.test/hook' })
    expect(a.secreto).not.toBe(b.secreto)
  })

  /** El buffering agrupa los mensajes seguidos de un cliente: sin él, "hola" /
   *  "tenés fundas?" / "de iPhone 13" son tres corridas del agente y tres
   *  respuestas por una sola pregunta. */
  it('pide payload v2 y buffering', async () => {
    fetchFalso.mockResolvedValue(respuesta({ data: { id: 'wh_1' } }))
    await crearWebhookDeMensajes({ phoneNumberId: 'pn_1', url: 'https://x.test/hook' })
    const w = llamada().body.whatsapp_webhook
    expect(w.payload_version).toBe('v2')
    expect(w.buffer_enabled).toBe(true)
    expect(w.events).toEqual(['whatsapp.message.received'])
  })

  it('va al endpoint del número y con la API key en el header', async () => {
    fetchFalso.mockResolvedValue(respuesta({ data: { id: 'wh_1' } }))
    await crearWebhookDeMensajes({ phoneNumberId: 'pn 1/raro', url: 'https://x.test/hook' })
    const { url, init } = llamada()
    expect(url).toContain('/platform/v1/whatsapp/phone_numbers/pn%201%2Fraro/webhooks')
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('clave-de-prueba')
  })

  it('si Kapso rechaza, el error lleva el status y un mensaje legible', async () => {
    fetchFalso.mockResolvedValue(respuesta({ error: "Secret key can't be blank" }, 422))
    await expect(
      crearWebhookDeMensajes({ phoneNumberId: 'pn_1', url: 'https://x.test/hook' }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('sin id en la respuesta falla ruidosamente', async () => {
    fetchFalso.mockResolvedValue(respuesta({ data: {} }))
    await expect(
      crearWebhookDeMensajes({ phoneNumberId: 'pn_1', url: 'https://x.test/hook' }),
    ).rejects.toBeInstanceOf(ErrorDeKapso)
  })
})

describe('enviar un mensaje', () => {
  it('va por el proxy de Meta con el payload de WhatsApp', async () => {
    fetchFalso.mockResolvedValue(respuesta({ messages: [{ id: 'wamid.OUT' }] }))
    const wamid = await enviarTexto({ phoneNumberId: 'pn_1', a: '+5491155550000', texto: 'hola' })

    const { url, body } = llamada()
    expect(url).toContain('/meta/whatsapp/v24.0/pn_1/messages')
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '+5491155550000',
      type: 'text',
      text: { body: 'hola' },
    })
    expect(wamid).toBe('wamid.OUT')
  })

  /** Un 403 del sandbox por un destinatario no suscripto, que es lo que pasó en
   *  la primera prueba real: tiene que llegar como ErrorDeKapso para que
   *  `procesarMensaje` lo asiente como respuesta fallida y NO consuma tope. */
  it('un rechazo de WhatsApp llega como ErrorDeKapso, no como excepción cruda', async () => {
    fetchFalso.mockResolvedValue(respuesta({ error: 'not allowed' }, 403))
    await expect(
      enviarTexto({ phoneNumberId: 'pn_1', a: '+5491100000000', texto: 'hola' }),
    ).rejects.toMatchObject({ name: 'ErrorDeKapso', status: 403 })
  })

  it('un problema de red no deja escapar el error crudo', async () => {
    fetchFalso.mockRejectedValue(new TypeError('fetch failed'))
    await expect(
      enviarTexto({ phoneNumberId: 'pn_1', a: '+549', texto: 'hola' }),
    ).rejects.toBeInstanceOf(ErrorDeKapso)
  })
})

describe('sin credenciales', () => {
  it('kapsoConfigurado avisa, y llamar falla con un mensaje para el dueño', async () => {
    delete process.env.KAPSO_API_KEY
    expect(kapsoConfigurado()).toBe(false)
    await expect(
      enviarTexto({ phoneNumberId: 'pn_1', a: '+549', texto: 'hola' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('no está disponible') })
  })
})
