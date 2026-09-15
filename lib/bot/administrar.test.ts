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
let otroTenantId: string
let administrar: typeof import('@/lib/bot/administrar')

beforeEach(async () => {
  vi.clearAllMocks()
  await owner.query('DELETE FROM bots_de_whatsapp')
  await owner.query('DELETE FROM numeros_de_prueba_bot')
  await owner.query('DELETE FROM conversaciones_bot')
})

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, 'bot-administrar')
  otroTenantId = await crearTenant(owner, 'bot-administrar-otro')
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

async function conectado(modo: 'APAGADO' | 'PRUEBA' | 'TODOS' = 'APAGADO') {
  await owner.query(
    `INSERT INTO bots_de_whatsapp
       (id, tenant_id, kapso_customer_id, phone_number_id, webhook_secreto, modo, activo, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'cus_1', 'pn_1', 'sec_1', $2, $3, now(), now())`,
    [tenantId, modo, modo === 'TODOS'],
  )
}

async function estadoDelBot() {
  const { rows } = await owner.query(
    'SELECT modo, activo FROM bots_de_whatsapp WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0] as { modo: string; activo: boolean }
}

async function digitosCargados(tenant = tenantId) {
  const { rows } = await owner.query(
    'SELECT digitos FROM numeros_de_prueba_bot WHERE tenant_id = $1 ORDER BY creado_en',
    [tenant],
  )
  return rows.map((r) => r.digitos as string)
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
      'SELECT phone_number_id, webhook_secreto, activo, conectado_en, modo FROM bots_de_whatsapp WHERE tenant_id = $1',
      [tenantId],
    )
    expect(rows[0].phone_number_id).toBe('pn_mio')
    expect(rows[0].webhook_secreto).toBe('sec_1')
    expect(rows[0].conectado_en).not.toBeNull()
    // Conectar el número y ponerlo a contestar son dos decisiones.
    expect(rows[0].activo, 'el bot arrancó contestando sin que nadie lo prendiera').toBe(false)
    expect(rows[0].modo).toBe('APAGADO')
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
         (id, tenant_id, kapso_customer_id, phone_number_id, webhook_id, webhook_secreto, activo, modo, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'cus_1', 'pn_1', 'wh_1', 'sec_1', true, 'TODOS', now(), now())`,
      [tenantId],
    )
    borrarWebhook.mockRejectedValue(new Error('Kapso caído'))

    await administrar.desconectar(tenantId)

    const { rows } = await owner.query(
      'SELECT phone_number_id, webhook_secreto, activo, kapso_customer_id, modo FROM bots_de_whatsapp WHERE tenant_id = $1',
      [tenantId],
    )
    expect(rows[0].phone_number_id).toBeNull()
    expect(rows[0].webhook_secreto).toBeNull()
    expect(rows[0].activo).toBe(false)
    // El customer sobrevive: reconectar no tiene por qué crear uno nuevo, y dos
    // customers para el mismo local dejarían los números repartidos entre ambos.
    expect(rows[0].kapso_customer_id).toBe('cus_1')
    expect(rows[0].modo).toBe('APAGADO')
  })
})

describe('la información del local', () => {
  it('rechaza un texto más largo que el tope y no escribe', async () => {
    await expect(
      administrar.guardarInformacion(tenantId, { aQueSeDedica: '', instrucciones: 'a'.repeat(2001) }),
    ).rejects.toMatchObject({ codigo: 'INSTRUCCIONES_LARGAS' })
  })

  it('rechaza una dedicación más larga que el tope y no escribe', async () => {
    await expect(
      administrar.guardarInformacion(tenantId, { aQueSeDedica: 'b'.repeat(201), instrucciones: '' }),
    ).rejects.toMatchObject({ codigo: 'DEDICACION_LARGA' })
  })

  it('se puede escribir antes de conectar ningún número', async () => {
    await administrar.guardarInformacion(tenantId, {
      aQueSeDedica: '  una waflería  ',
      instrucciones: '  Abrimos de 9 a 18.  ',
    })
    const { rows } = await owner.query(
      'SELECT a_que_se_dedica, instrucciones FROM bots_de_whatsapp WHERE tenant_id = $1',
      [tenantId],
    )
    expect(rows[0].instrucciones).toBe('Abrimos de 9 a 18.')
    expect(rows[0].a_que_se_dedica).toBe('una waflería')
  })

  /**
   * Los dos campos se escriben en la misma visita y con el mismo botón, así que
   * los guarda una sola escritura: dos upserts dejarían la fila a medio guardar
   * si el segundo falla.
   */
  it('guarda los dos campos juntos sobre una fila que ya existía', async () => {
    await administrar.guardarInformacion(tenantId, {
      aQueSeDedica: 'una waflería',
      instrucciones: 'Abrimos de 9 a 18.',
    })
    await administrar.guardarInformacion(tenantId, {
      aQueSeDedica: 'una waflería y cafetería',
      instrucciones: 'Abrimos de 9 a 20.',
    })
    const { rows } = await owner.query(
      'SELECT a_que_se_dedica, instrucciones FROM bots_de_whatsapp WHERE tenant_id = $1',
      [tenantId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].a_que_se_dedica).toBe('una waflería y cafetería')
    expect(rows[0].instrucciones).toBe('Abrimos de 9 a 20.')
  })

  it('lo que la pantalla lee incluye a qué se dedica el local', async () => {
    await administrar.guardarInformacion(tenantId, {
      aQueSeDedica: 'una waflería',
      instrucciones: '',
    })
    expect(await administrar.botDelLocal(tenantId)).toMatchObject({ aQueSeDedica: 'una waflería' })
  })

  it('el local que nunca tocó la pantalla no se dedica a nada declarado', async () => {
    expect(await administrar.botDelLocal(tenantId)).toMatchObject({ aQueSeDedica: '' })
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

describe('cambiar el modo', () => {
  /**
   * El valor de `activo` es el que hace seguro el rollback (spec, decisión 4):
   * la imagen anterior sólo lee esa columna, y en prueba tiene que leer `false`
   * para callarse en vez de contestarles a todos.
   */
  it('en prueba deja activo en false', async () => {
    await conectado('TODOS')
    await administrar.cambiarModo(tenantId, 'PRUEBA')
    expect(await estadoDelBot()).toEqual({ modo: 'PRUEBA', activo: false })
  })

  it('en todos deja activo en true', async () => {
    await conectado('PRUEBA')
    await administrar.cambiarModo(tenantId, 'TODOS')
    expect(await estadoDelBot()).toEqual({ modo: 'TODOS', activo: true })
  })

  it('apagado deja activo en false', async () => {
    await conectado('TODOS')
    await administrar.cambiarModo(tenantId, 'APAGADO')
    expect(await estadoDelBot()).toEqual({ modo: 'APAGADO', activo: false })
  })

  it('no se puede pasar a prueba ni a todos sin número conectado', async () => {
    await conCustomer()
    await expect(administrar.cambiarModo(tenantId, 'PRUEBA')).rejects.toMatchObject({ codigo: 'SIN_NUMERO' })
    await expect(administrar.cambiarModo(tenantId, 'TODOS')).rejects.toMatchObject({ codigo: 'SIN_NUMERO' })
  })

  /** Lo que llega a la server action es un string del navegador. */
  it('rechaza un modo que no existe y no escribe', async () => {
    await conectado('APAGADO')
    await expect(administrar.cambiarModo(tenantId, 'ENCENDIDO')).rejects.toMatchObject({
      codigo: 'MODO_INVALIDO',
    })
    expect(await estadoDelBot()).toEqual({ modo: 'APAGADO', activo: false })
  })

  it('lo que la pantalla lee incluye el modo', async () => {
    await conectado('PRUEBA')
    expect(await administrar.botDelLocal(tenantId)).toMatchObject({ modo: 'PRUEBA' })
  })

  it('el local que nunca tocó la pantalla está apagado', async () => {
    expect(await administrar.botDelLocal(tenantId)).toMatchObject({ modo: 'APAGADO' })
  })
})

describe('los números de prueba', () => {
  it('guarda sólo los dígitos, tal como se tipearon', async () => {
    await administrar.agregarNumeroDePrueba(tenantId, '+54 9 11 2233-4455')
    expect(await digitosCargados()).toEqual(['5491122334455'])
  })

  it('rechaza un número sin código de área y no escribe', async () => {
    await expect(administrar.agregarNumeroDePrueba(tenantId, '2233-4455')).rejects.toMatchObject({
      codigo: 'NUMERO_CORTO',
    })
    expect(await digitosCargados()).toEqual([])
  })

  it('rechaza un número de más de 15 dígitos', async () => {
    await expect(
      administrar.agregarNumeroDePrueba(tenantId, '1234567890123456'),
    ).rejects.toMatchObject({ codigo: 'NUMERO_LARGO' })
  })

  it('rechaza el mismo número repetido', async () => {
    await administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')
    await expect(administrar.agregarNumeroDePrueba(tenantId, '1122334455')).rejects.toMatchObject({
      codigo: 'NUMERO_REPETIDO',
    })
    expect(await digitosCargados()).toHaveLength(1)
  })

  /** Dos formas del mismo teléfono son el mismo número de prueba. */
  it('rechaza el mismo teléfono escrito de otra forma', async () => {
    await administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')
    await expect(
      administrar.agregarNumeroDePrueba(tenantId, '+54 9 11 2233 4455'),
    ).rejects.toMatchObject({ codigo: 'NUMERO_REPETIDO' })
    expect(await digitosCargados()).toEqual(['1122334455'])
  })

  it('no deja pasar del tope de 20', async () => {
    for (let i = 0; i < 20; i++) {
      await owner.query(
        `INSERT INTO numeros_de_prueba_bot (id, tenant_id, digitos, creado_en)
         VALUES (gen_random_uuid(), $1, $2, now())`,
        [tenantId, `11000000${String(i).padStart(2, '0')}`],
      )
    }
    await expect(administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')).rejects.toMatchObject({
      codigo: 'TOPE_NUMEROS',
    })
    expect(await digitosCargados()).toHaveLength(20)
  })

  it('quita un número propio', async () => {
    await administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')
    const [{ id }] = await administrar.numerosDePruebaDelLocal(tenantId)
    await administrar.quitarNumeroDePrueba(tenantId, id)
    expect(await digitosCargados()).toEqual([])
  })

  it('quitar el id de un número de otro local no borra nada', async () => {
    const { rows } = await owner.query(
      `INSERT INTO numeros_de_prueba_bot (id, tenant_id, digitos, creado_en)
       VALUES (gen_random_uuid(), $1, '1122334455', now()) RETURNING id`,
      [otroTenantId],
    )
    await administrar.quitarNumeroDePrueba(tenantId, rows[0].id)
    expect(await digitosCargados(otroTenantId), 'se borró el número de prueba de otro local').toEqual([
      '1122334455',
    ])
  })

  it('un id que no es un uuid no rompe ni borra nada', async () => {
    await administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')
    await expect(administrar.quitarNumeroDePrueba(tenantId, 'no-es-un-uuid')).resolves.toBeUndefined()
    expect(await digitosCargados()).toHaveLength(1)
  })

  /**
   * La línea "Último mensaje" es la verificación del número: si el dueño se
   * escribe desde ese celular y la fila sigue diciendo "Todavía no escribió",
   * el número está mal cargado (spec, decisión 2).
   */
  it('cada número dice cuándo escribió por última vez quien coincide con él', async () => {
    const cuando = new Date('2026-09-15T17:32:00Z')
    await owner.query(
      `INSERT INTO conversaciones_bot (id, tenant_id, wa_id, creado_en, ultimo_mensaje_en)
       VALUES (gen_random_uuid(), $1, '+5491122334455', now(), $2)`,
      [tenantId, cuando],
    )
    await administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')
    await administrar.agregarNumeroDePrueba(tenantId, '11 9999-8888')

    const vistos = await administrar.numerosDePruebaDelLocal(tenantId)
    expect(vistos.map((v) => [v.digitos, v.ultimoMensajeEn?.toISOString() ?? null])).toEqual([
      ['1122334455', cuando.toISOString()],
      ['1199998888', null],
    ])
  })

  it('el número tipeado con 0 y 15 no encuentra la conversación', async () => {
    await owner.query(
      `INSERT INTO conversaciones_bot (id, tenant_id, wa_id, creado_en, ultimo_mensaje_en)
       VALUES (gen_random_uuid(), $1, '+5491122334455', now(), now())`,
      [tenantId],
    )
    await administrar.agregarNumeroDePrueba(tenantId, '011 15 2233-4455')
    const [visto] = await administrar.numerosDePruebaDelLocal(tenantId)
    expect(visto.ultimoMensajeEn).toBeNull()
  })

  it('sin números no consulta conversaciones y devuelve la lista vacía', async () => {
    expect(await administrar.numerosDePruebaDelLocal(tenantId)).toEqual([])
  })
})
