import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

const numerosDelCustomer = vi.fn()
const crearWebhookDeMensajes = vi.fn()
const crearCustomer = vi.fn()
const crearEnlaceDeConexion = vi.fn()
const borrarWebhook = vi.fn()

vi.mock('@/lib/bot/kapso', () => ({
  kapsoConfigurado: () => true,
  numerosDelCustomer: (...a: unknown[]) => numerosDelCustomer(...a),
  crearWebhookDeMensajes: (...a: unknown[]) => crearWebhookDeMensajes(...a),
  crearCustomer: (...a: unknown[]) => crearCustomer(...a),
  crearEnlaceDeConexion: (...a: unknown[]) => crearEnlaceDeConexion(...a),
  borrarWebhook: (...a: unknown[]) => borrarWebhook(...a),
  ErrorDeKapso: class extends Error {},
}))
// `origenDelRequest` lee headers() de Next, que no existe fuera de un request.
vi.mock('@/lib/auth/origen', () => ({
  origenDelRequest: async (sub: string) => `https://${sub}.arandano.app`,
}))

let owner: Client
let tenantId: string
let administrar: typeof import('@/lib/bot/administrar')

beforeEach(async () => {
  vi.clearAllMocks()
  await owner.query('DELETE FROM bots_de_whatsapp')
})

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, 'bot-administrar')
  process.env.DATABASE_URL = urlApp()
  administrar = await import('@/lib/bot/administrar')
})

afterAll(async () => {
  await owner.end()
})


async function conCustomer() {
  await owner.query(
    `INSERT INTO bots_de_whatsapp (id, tenant_id, kapso_customer_id, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'cus_1', now(), now())`,
    [tenantId],
  )
}

describe('confirmar el número del local', () => {
  /**
   * EL caso de seguridad del flujo de conexión.
   *
   * El `phoneNumberId` que llega es una SELECCIÓN entre lo que Kapso dice que es
   * de este local, no una afirmación. Un formulario es tan falsificable como la
   * query string de un redirect: sin re-verificar contra Kapso, este POST
   * tendría exactamente el mismo agujero que tendría escribir desde el GET del
   * redirect —un id ajeno conectaría el número de otro comercio, y a partir de
   * ahí el bot de ese local contestaría con ESTE catálogo.
   */
  it('rechaza un número que Kapso no lista para este local, y no escribe nada', async () => {
    await conCustomer()
    numerosDelCustomer.mockResolvedValue([
      { phoneNumberId: 'pn_mio', numeroVisible: '+5491155550000', wabaId: null },
    ])

    await expect(
      administrar.confirmarNumero({
        tenantId,
        subdominio: 'bot-administrar',
        phoneNumberId: 'pn_de_otro_comercio',
      }),
    ).rejects.toMatchObject({ codigo: 'NUMERO_AJENO' })

    expect(crearWebhookDeMensajes, 'se registró un webhook para un número ajeno').not.toHaveBeenCalled()
    const { rows } = await owner.query(
      'SELECT phone_number_id FROM bots_de_whatsapp WHERE tenant_id = $1',
      [tenantId],
    )
    expect(rows[0].phone_number_id, 'se conectó un número ajeno').toBeNull()
  })

  it('conecta el número propio, guarda el secreto y lo deja APAGADO', async () => {
    await conCustomer()
    numerosDelCustomer.mockResolvedValue([
      { phoneNumberId: 'pn_mio', numeroVisible: '+5491155550000', wabaId: 'waba_1' },
    ])
    crearWebhookDeMensajes.mockResolvedValue({ id: 'wh_1', secreto: 'sec_1' })

    await administrar.confirmarNumero({
      tenantId,
      subdominio: 'bot-administrar',
      phoneNumberId: 'pn_mio',
    })

    const { rows } = await owner.query(
      'SELECT phone_number_id, webhook_secreto, activo, conectado_en FROM bots_de_whatsapp WHERE tenant_id = $1',
      [tenantId],
    )
    expect(rows[0].phone_number_id).toBe('pn_mio')
    expect(rows[0].webhook_secreto).toBe('sec_1')
    expect(rows[0].conectado_en).not.toBeNull()
    // Conectar el número y ponerlo a contestar son dos decisiones.
    expect(rows[0].activo, 'el bot arrancó contestando sin que nadie lo prendiera').toBe(false)
  })

  /** El webhook lleva el subdominio del tenant: es lo que después permite que
   *  `tenantDelRequest()` resuelva el local del otro lado. */
  it('registra el webhook con la URL del subdominio del local', async () => {
    await conCustomer()
    numerosDelCustomer.mockResolvedValue([
      { phoneNumberId: 'pn_mio', numeroVisible: null, wabaId: null },
    ])
    crearWebhookDeMensajes.mockResolvedValue({ id: 'wh_1', secreto: 'sec_1' })

    await administrar.confirmarNumero({
      tenantId,
      subdominio: 'bot-administrar',
      phoneNumberId: 'pn_mio',
    })

    expect(crearWebhookDeMensajes).toHaveBeenCalledWith({
      phoneNumberId: 'pn_mio',
      url: 'https://bot-administrar.arandano.app/api/whatsapp/webhook',
    })
  })
})

describe('desconectar', () => {
  /**
   * El estado local es lo ÚNICO que decide si contestamos —el webhook devuelve
   * 404 sin `phoneNumberId` contra el cual comparar—, así que un webhook
   * huérfano en Kapso no puede hacer hablar al bot. Lo que el dueño pidió es
   * dejar de responder, y eso lo garantiza limpiar nuestra fila.
   */
  it('limpia lo local aunque Kapso no responda', async () => {
    await owner.query(
      `INSERT INTO bots_de_whatsapp
         (id, tenant_id, kapso_customer_id, phone_number_id, webhook_id, webhook_secreto, activo, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'cus_1', 'pn_1', 'wh_1', 'sec_1', true, now(), now())`,
      [tenantId],
    )
    borrarWebhook.mockRejectedValue(new Error('Kapso caído'))

    await administrar.desconectar(tenantId)

    const { rows } = await owner.query(
      'SELECT phone_number_id, webhook_secreto, activo, kapso_customer_id FROM bots_de_whatsapp WHERE tenant_id = $1',
      [tenantId],
    )
    expect(rows[0].phone_number_id).toBeNull()
    expect(rows[0].webhook_secreto).toBeNull()
    expect(rows[0].activo).toBe(false)
    // El customer sobrevive: reconectar no tiene por qué crear uno nuevo, y dos
    // customers para el mismo local dejarían los números repartidos entre ambos.
    expect(rows[0].kapso_customer_id).toBe('cus_1')
  })
})

describe('la información del local', () => {
  it('rechaza un texto más largo que el tope y no escribe', async () => {
    await expect(
      administrar.guardarInstrucciones(tenantId, 'a'.repeat(2001)),
    ).rejects.toMatchObject({ codigo: 'INSTRUCCIONES_LARGAS' })
  })

  it('se puede escribir antes de conectar ningún número', async () => {
    await administrar.guardarInstrucciones(tenantId, '  Abrimos de 9 a 18.  ')
    const { rows } = await owner.query(
      'SELECT instrucciones FROM bots_de_whatsapp WHERE tenant_id = $1',
      [tenantId],
    )
    expect(rows[0].instrucciones).toBe('Abrimos de 9 a 18.')
  })
})

describe('prender el bot', () => {
  it('no se puede prender sin número conectado', async () => {
    await conCustomer()
    await expect(administrar.alternarActivo(tenantId, true)).rejects.toMatchObject({
      codigo: 'SIN_NUMERO',
    })
  })
})
