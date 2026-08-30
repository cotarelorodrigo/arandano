import { describe, it, expect } from 'vitest'
import { mensajesDelWebhook, phoneNumberIdDe } from '@/lib/bot/payload'

const evento = (extra: Record<string, unknown> = {}) => ({
  phone_number_id: '123456789012345',
  is_new_conversation: false,
  message: {
    id: 'wamid.ABC',
    timestamp: '1730092800',
    type: 'text',
    text: { body: 'hola' },
    kapso: { direction: 'inbound', content: 'hola', has_media: false },
  },
  conversation: {
    id: 'conv_1',
    phone_number: '+5491155550000',
    phone_number_id: '123456789012345',
    kapso: { contact_name: 'Ana' },
  },
  ...extra,
})

describe('el payload del webhook', () => {
  it('lee el phone_number_id de la raíz', () => {
    expect(phoneNumberIdDe(evento())).toBe('123456789012345')
    expect(phoneNumberIdDe({})).toBeNull()
    expect(phoneNumberIdDe('no es un objeto')).toBeNull()
  })

  it('saca un mensaje de un evento suelto', () => {
    const [m] = mensajesDelWebhook(evento())
    expect(m).toEqual({
      wamid: 'wamid.ABC',
      waId: '+5491155550000',
      kapsoConversacionId: 'conv_1',
      nombreContacto: 'Ana',
      texto: 'hola',
    })
  })

  /**
   * `kapso.content` es la representación en texto de CUALQUIER tipo de mensaje,
   * transcript de audio incluido. Leer sólo `text.body` dejaría mudo al caso
   * frecuente: en Argentina se pregunta un precio por audio.
   */
  it('prefiere kapso.content, que trae el transcript de un audio', () => {
    const audio = evento({
      message: {
        id: 'wamid.AUD',
        type: 'audio',
        audio: { id: 'media_1' },
        kapso: {
          direction: 'inbound',
          has_media: true,
          content: '[Audio adjunto]\nTranscript: ¿tenés fundas de iPhone?',
          transcript: { text: '¿tenés fundas de iPhone?' },
        },
      },
    })
    expect(mensajesDelWebhook(audio)[0].texto).toContain('¿tenés fundas de iPhone?')
  })

  it('cae a text.body cuando no hay content', () => {
    const sinContent = evento({
      message: { id: 'wamid.T', type: 'text', text: { body: 'buenas' }, kapso: { direction: 'inbound' } },
    })
    expect(mensajesDelWebhook(sinContent)[0].texto).toBe('buenas')
  })

  it('un mensaje sin nada legible queda con texto vacío, no se descarta', () => {
    const sticker = evento({
      message: { id: 'wamid.S', type: 'sticker', kapso: { direction: 'inbound', has_media: true } },
    })
    const [m] = mensajesDelWebhook(sticker)
    expect(m.texto).toBe('')
    expect(m.wamid, 'un sticker igual tiene que quedar registrado').toBe('wamid.S')
  })

  /**
   * En coexistencia el dueño sigue contestando desde su celular, y ese mensaje
   * también pasa por Kapso como eco. El bot no tiene que responderle a su
   * propio local.
   */
  it('descarta el eco de un mensaje saliente del propio local', () => {
    const eco = evento({
      message: {
        id: 'wamid.OUT',
        type: 'text',
        text: { body: 'ya te contesto' },
        kapso: { direction: 'outbound', content: 'ya te contesto' },
      },
    })
    expect(mensajesDelWebhook(eco)).toHaveLength(0)
  })

  it('descarta lo que no tiene wamid o no tiene teléfono', () => {
    expect(mensajesDelWebhook(evento({ message: { type: 'text', kapso: {} } }))).toHaveLength(0)
    expect(mensajesDelWebhook(evento({ conversation: { id: 'c' } }))).toHaveLength(0)
    expect(mensajesDelWebhook(null)).toHaveLength(0)
    expect(mensajesDelWebhook([])).toHaveLength(0)
  })

  /**
   * El buffering agrupa los mensajes seguidos del mismo cliente. Kapso declara
   * los headers del lote pero NO la forma del cuerpo, así que se aceptan las dos
   * que puede tomar. Es más código que adivinar una — y es lo que evita que el
   * bot quede mudo si la forma no era la supuesta.
   */
  it('entiende un lote como array de eventos', () => {
    const dos = [evento(), evento({ message: { ...evento().message, id: 'wamid.DEF' } })]
    expect(mensajesDelWebhook(dos).map((m) => m.wamid)).toEqual(['wamid.ABC', 'wamid.DEF'])
  })

  it('entiende un lote como sobre con la lista adentro', () => {
    const sobre = {
      phone_number_id: '123456789012345',
      conversation: evento().conversation,
      messages: [
        { id: 'wamid.1', type: 'text', text: { body: 'hola' }, kapso: { direction: 'inbound', content: 'hola' } },
        { id: 'wamid.2', type: 'text', text: { body: 'tenés fundas?' }, kapso: { direction: 'inbound', content: 'tenés fundas?' } },
      ],
    }
    expect(mensajesDelWebhook(sobre).map((m) => m.texto)).toEqual(['hola', 'tenés fundas?'])
  })
})

/**
 * El sobre REAL de un lote de Kapso, copiado de la primera entrega verdadera
 * —un WhatsApp de una persona— tal como la capturó el túnel.
 *
 * Está acá con nombres y contenido cambiados pero con la ESTRUCTURA intacta,
 * porque la estructura es justamente lo que este ciclo adivinó mal tres veces:
 * el array se llama `data` (no `messages`, ni `events`, ni `batch` — `batch` es
 * un BOOLEANO en el sobre), y el `phone_number_id` NO está en la raíz sino
 * adentro de cada elemento.
 *
 * El síntoma de errarle fue un 404 silencioso: Kapso reintentó cinco veces, el
 * webhook rechazó las cinco, y el mensaje del cliente se perdió sin que nada se
 * quejara. Ningún test podía verlo, porque todos usaban un sobre inventado.
 */
const LOTE_REAL = {
  type: 'whatsapp.message.received',
  batch: true,
  data: [
    {
      message: {
        context: null,
        from: '541100000000',
        id: 'wamid.HBgNNTQ5MTEzMjY3Mjk3MxUCABIYIEFDRjJ',
        kapso: {
          direction: 'inbound',
          status: 'delivered',
          processing_status: 'pending',
          has_media: false,
          origin: 'cloud_api',
          content: 'Hola, tenes cargadores usb c',
        },
        text: { body: 'Hola, tenes cargadores usb c' },
        timestamp: '1788047027',
        type: 'text',
      },
      conversation: {
        id: 'd641996d-de58-4f5c-b763-843d94fdbab7',
        contact_name: 'Una Persona',
        kapso: { messages_count: 2, last_message_text: 'Hola, tenes cargadores usb c' },
        phone_number: '541100000000',
        phone_number_id: '597907523413541',
        status: 'active',
      },
      is_new_conversation: false,
      phone_number_id: '597907523413541',
    },
  ],
  batch_info: { size: 1, window_ms: 8000, first_sequence: 1, last_sequence: 1 },
}

describe('el sobre real de un lote de Kapso', () => {
  it('encuentra el phone_number_id aunque NO esté en la raíz', () => {
    expect((LOTE_REAL as Record<string, unknown>).phone_number_id).toBeUndefined()
    expect(phoneNumberIdDe(LOTE_REAL)).toBe('597907523413541')
  })

  it('saca el mensaje de la clave `data`', () => {
    const [m] = mensajesDelWebhook(LOTE_REAL)
    expect(m).toEqual({
      wamid: 'wamid.HBgNNTQ5MTEzMjY3Mjk3MxUCABIYIEFDRjJ',
      waId: '541100000000',
      kapsoConversacionId: 'd641996d-de58-4f5c-b763-843d94fdbab7',
      nombreContacto: 'Una Persona',
      texto: 'Hola, tenes cargadores usb c',
    })
  })

  /** `batch` viene como booleano en el sobre: confundirlo con la lista dejaría
   *  la búsqueda del array en un `true` y el mensaje sin parsear. */
  it('no confunde el booleano `batch` con la lista', () => {
    expect(mensajesDelWebhook(LOTE_REAL)).toHaveLength(1)
  })

  it('un lote de varios trae todos', () => {
    const dos = {
      ...LOTE_REAL,
      data: [
        LOTE_REAL.data[0],
        {
          ...LOTE_REAL.data[0],
          message: {
            ...LOTE_REAL.data[0].message,
            id: 'wamid.SEGUNDO',
            kapso: { ...LOTE_REAL.data[0].message.kapso, content: 'de los rapidos' },
          },
        },
      ],
      batch_info: { ...LOTE_REAL.batch_info, size: 2, last_sequence: 2 },
    }
    expect(mensajesDelWebhook(dos).map((m) => m.texto)).toEqual([
      'Hola, tenes cargadores usb c',
      'de los rapidos',
    ])
  })
})

